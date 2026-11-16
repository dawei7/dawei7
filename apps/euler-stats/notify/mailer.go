package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"
)

const (
	DefaultGmailAddress = "ai.professor.euler@gmail.com"
	DefaultSMTPHost     = "smtp.gmail.com"
	DefaultSMTPPort     = "587"
)

// ErrNotConfigured is returned when SMTP credentials are not yet set.
var ErrNotConfigured = errors.New("SMTP password not configured (set SMTP_PASSWORD / EULER_STATS_SMTP_PASSWORD)")

// SMTPStatus summarizes email transport readiness without exposing credentials.
type SMTPStatus struct {
	Configured  bool   `json:"configured"`
	Host        string `json:"host"`
	Port        string `json:"port"`
	Username    string `json:"username"`
	From        string `json:"from"`
	DefaultDest string `json:"default_recipient"`
}

// Sender sends plain-text and HTML multipart emails.
type Sender interface {
	Send(ctx context.Context, to, subject, textBody, htmlBody string) error
	Status() SMTPStatus
}

// SMTPMailer delivers email notifications via Gmail / standard SMTP (STARTTLS or SMTPS).
type SMTPMailer struct {
	host        string
	port        string
	username    string
	password    string
	from        string
	defaultDest string
}

// NewSMTPMailerFromEnv reads SMTP configuration with Gmail defaults for ai.professor.euler@gmail.com.
func NewSMTPMailerFromEnv() *SMTPMailer {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if host == "" {
		host = DefaultSMTPHost
	}
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if port == "" {
		port = DefaultSMTPPort
	}
	user := strings.TrimSpace(os.Getenv("SMTP_USERNAME"))
	if user == "" {
		user = DefaultGmailAddress
	}
	// Google displays 16-char App Passwords with spaces ("xxxx xxxx xxxx xxxx"); strip them cleanly.
	pass := strings.ReplaceAll(strings.TrimSpace(os.Getenv("SMTP_PASSWORD")), " ", "")
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	if from == "" {
		from = fmt.Sprintf("Professor Euler Stats <%s>", user)
	}
	dest := strings.TrimSpace(os.Getenv("NOTIFY_RECIPIENT_EMAIL"))
	if dest == "" {
		dest = DefaultGmailAddress
	}

	return &SMTPMailer{
		host:        host,
		port:        port,
		username:    user,
		password:    pass,
		from:        from,
		defaultDest: dest,
	}
}

// Status reports non-secret transport readiness.
func (m *SMTPMailer) Status() SMTPStatus {
	return SMTPStatus{
		Configured:  m.password != "" && m.username != "" && m.host != "",
		Host:        m.host,
		Port:        m.port,
		Username:    m.username,
		From:        m.from,
		DefaultDest: m.defaultDest,
	}
}

// Send dispatches a UTF-8 multipart/alternative message via STARTTLS (587) with SMTPS (465) fallback for Gmail.
func (m *SMTPMailer) Send(ctx context.Context, to, subject, textBody, htmlBody string) error {
	if m.password == "" {
		return ErrNotConfigured
	}
	toAddr, err := mail.ParseAddress(strings.TrimSpace(to))
	if err != nil {
		return fmt.Errorf("invalid recipient address %q: %w", to, err)
	}
	fromAddr, err := mail.ParseAddress(m.from)
	if err != nil {
		fromAddr = &mail.Address{Name: "Professor Euler Stats", Address: m.username}
	}

	msg := buildMIME(fromAddr, toAddr, subject, textBody, htmlBody)

	ports := []string{m.port}
	if m.host == "smtp.gmail.com" && m.port == "587" {
		ports = append(ports, "465")
	}

	var lastErr error
	for _, p := range ports {
		attemptCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := m.sendViaPort(attemptCtx, p, fromAddr.Address, toAddr.Address, msg)
		cancel()
		if err == nil {
			return nil
		}
		lastErr = err
	}
	return lastErr
}

func (m *SMTPMailer) sendViaPort(ctx context.Context, port, fromEmail, toEmail string, msg []byte) error {
	addr := net.JoinHostPort(m.host, port)
	tlsCfg := &tls.Config{
		ServerName: m.host,
		MinVersion: tls.VersionTLS12,
	}

	var conn net.Conn
	var err error
	if port == "465" {
		d := &tls.Dialer{
			NetDialer: &net.Dialer{Timeout: 10 * time.Second},
			Config:    tlsCfg,
		}
		conn, err = d.DialContext(ctx, "tcp", addr)
	} else {
		d := &net.Dialer{Timeout: 10 * time.Second}
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("dial %s: %w", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp hello %s: %w", addr, err)
	}
	defer client.Close()

	if port != "465" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return fmt.Errorf("smtp server %s does not advertise STARTTLS", addr)
		}
		if err := client.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("starttls %s: %w", addr, err)
		}
	}

	auth := smtp.PlainAuth("", m.username, m.password, m.host)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := client.Mail(fromEmail); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := client.Rcpt(toEmail); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		_ = w.Close()
		return fmt.Errorf("write email body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("finalize email body: %w", err)
	}
	return client.Quit()
}

func buildMIME(fromAddr, toAddr *mail.Address, subject, textBody, htmlBody string) []byte {
	boundary := "euler-" + randomHex(12)
	cleanSubj := sanitizeHeader(subject)
	encodedSubj := mime.BEncoding.Encode("utf-8", cleanSubj)

	var buf bytes.Buffer
	writeHdr := func(k, v string) {
		fmt.Fprintf(&buf, "%s: %s\r\n", k, v)
	}
	writeHdr("From", fromAddr.String())
	writeHdr("To", toAddr.String())
	writeHdr("Subject", encodedSubj)
	writeHdr("Date", time.Now().UTC().Format(time.RFC1123Z))
	writeHdr("Message-ID", fmt.Sprintf("<%s.%d@euler-stats.dawei7.com>", randomHex(8), time.Now().UnixNano()))
	writeHdr("MIME-Version", "1.0")
	writeHdr("Content-Type", fmt.Sprintf(`multipart/alternative; boundary="%s"`, boundary))
	buf.WriteString("\r\n")

	// Plain text part
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	writeHdr("Content-Type", `text/plain; charset="UTF-8"`)
	writeHdr("Content-Transfer-Encoding", "8bit")
	buf.WriteString("\r\n")
	buf.WriteString(normalizeCRLF(textBody))
	buf.WriteString("\r\n")

	// HTML part
	fmt.Fprintf(&buf, "--%s\r\n", boundary)
	writeHdr("Content-Type", `text/html; charset="UTF-8"`)
	writeHdr("Content-Transfer-Encoding", "8bit")
	buf.WriteString("\r\n")
	buf.WriteString(normalizeCRLF(htmlBody))
	buf.WriteString("\r\n")

	fmt.Fprintf(&buf, "--%s--\r\n", boundary)
	return buf.Bytes()
}

func sanitizeHeader(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func normalizeCRLF(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.ReplaceAll(s, "\n", "\r\n")
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
