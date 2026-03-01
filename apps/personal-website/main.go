package main

import (
	_ "embed"
	"log"
	"net/http"
	"os"

	"github.com/dawei7/dawei7/apps/personal-website/templates"
)

//go:embed public/style.css
var styleCSS []byte

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Home page — full page render
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := templates.Home(projects()).Render(r.Context(), w); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	// HTMX fragment — projects list loaded on page via hx-get
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := templates.ProjectList(projects()).Render(r.Context(), w); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	// Compiled Tailwind CSS
	mux.HandleFunc("GET /static/style.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Write(styleCSS)
	})

	// Health check (used by Traefik and CI)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	log.Printf("personal-website listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// projects returns the list of projects shown on the homepage.
// Add new entries here as you build more apps.
func projects() []templates.Project {
	return []templates.Project{
		{
			Title:       "dawei7/dawei7",
			Description: "Server infrastructure powering this site — Go, Docker, Traefik, PostgreSQL, Redis, GitHub Actions.",
			URL:         "https://github.com/dawei7/dawei7",
			Tags:        []string{"Go", "Docker", "Traefik", "Infrastructure"},
		},
		{
			Title:       "personal-website",
			Description: "This site — built with Go, Templ, and HTMX. Server-rendered HTML fragments, no JavaScript framework.",
			URL:         "https://github.com/dawei7/dawei7/tree/main/apps/personal-website",
			Tags:        []string{"Go", "Templ", "HTMX"},
		},
	}
}
