package play

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const DefaultTokenURI = "https://oauth2.googleapis.com/token"

var defaultScopes = []string{
	"https://www.googleapis.com/auth/devstorage.read_only",
	"https://www.googleapis.com/auth/playdeveloperreporting",
	"https://www.googleapis.com/auth/androidpublisher",
}

type serviceAccountKey struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

// TokenSource mints and caches Google OAuth2 bearer tokens using a Service Account JSON key.
type TokenSource struct {
	clientEmail string
	privateKey  *rsa.PrivateKey
	tokenURI    string
	scopes      string
	httpClient  *http.Client
	nowFn       func() time.Time

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

// LoadTokenSourceFromEnv loads credentials from PLAY_SERVICE_ACCOUNT_FILE,
// PLAY_SERVICE_ACCOUNT_JSON, or PLAY_SERVICE_ACCOUNT_B64. Returns (nil, nil) if unconfigured.
func LoadTokenSourceFromEnv() (*TokenSource, error) {
	var raw []byte
	if file := strings.TrimSpace(os.Getenv("PLAY_SERVICE_ACCOUNT_FILE")); file != "" {
		b, err := os.ReadFile(file)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, nil
			}
			return nil, fmt.Errorf("read PLAY_SERVICE_ACCOUNT_FILE: %w", err)
		}
		raw = b
	} else if inline := strings.TrimSpace(os.Getenv("PLAY_SERVICE_ACCOUNT_JSON")); inline != "" {
		raw = []byte(inline)
	} else if b64 := strings.TrimSpace(os.Getenv("PLAY_SERVICE_ACCOUNT_B64")); b64 != "" {
		b, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("decode PLAY_SERVICE_ACCOUNT_B64: %w", err)
		}
		raw = b
	} else {
		return nil, nil
	}
	return NewTokenSource(raw)
}

// NewTokenSource parses a Google Service Account JSON key into a TokenSource.
func NewTokenSource(keyJSON []byte) (*TokenSource, error) {
	var sa serviceAccountKey
	if err := json.Unmarshal(keyJSON, &sa); err != nil {
		return nil, fmt.Errorf("parse service account JSON: %w", err)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, fmt.Errorf("service account JSON missing client_email or private_key")
	}
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return nil, fmt.Errorf("invalid PEM private_key in service account JSON")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		if pk1, err1 := x509.ParsePKCS1PrivateKey(block.Bytes); err1 == nil {
			parsed = pk1
		} else {
			return nil, fmt.Errorf("parse RSA private key: %w", err)
		}
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("service account key is not RSA")
	}
	tokenURI := sa.TokenURI
	if tokenURI == "" {
		tokenURI = DefaultTokenURI
	}
	return &TokenSource{
		clientEmail: sa.ClientEmail,
		privateKey:  rsaKey,
		tokenURI:    tokenURI,
		scopes:      strings.Join(defaultScopes, " "),
		httpClient:  &http.Client{Timeout: 20 * time.Second},
		nowFn:       func() time.Time { return time.Now().UTC() },
	}, nil
}

// Token returns a cached or freshly minted OAuth2 access token.
func (ts *TokenSource) Token(ctx context.Context) (string, error) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	now := ts.nowFn()
	if ts.token != "" && now.Add(5*time.Minute).Before(ts.expiresAt) {
		return ts.token, nil
	}

	assertion, err := ts.signJWT(now)
	if err != nil {
		return "", err
	}

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ts.tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := ts.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("oauth token request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("oauth token HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", fmt.Errorf("decode oauth token: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("oauth token response missing access_token")
	}

	expSec := tr.ExpiresIn
	if expSec <= 0 {
		expSec = 3600
	}
	ts.token = tr.AccessToken
	ts.expiresAt = now.Add(time.Duration(expSec) * time.Second)
	return ts.token, nil
}

func (ts *TokenSource) signJWT(now time.Time) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claimsBytes, err := json.Marshal(map[string]any{
		"iss":   ts.clientEmail,
		"scope": ts.scopes,
		"aud":   ts.tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	if err != nil {
		return "", err
	}
	claims := base64.RawURLEncoding.EncodeToString(claimsBytes)
	signingInput := header + "." + claims

	sum := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, ts.privateKey, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}
