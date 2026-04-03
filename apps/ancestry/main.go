package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/dawei7/dawei7/apps/ancestry/db"
)

//go:embed all:frontend/dist
var staticFiles embed.FS

var uuidRE = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	mux := http.NewServeMux()

	// ── JSON API ──────────────────────────────────────────────────────────────

	// People list (search + pagination) → JSON
	mux.HandleFunc("GET /api/people", func(w http.ResponseWriter, r *http.Request) {
		search := r.URL.Query().Get("q")
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		const pageSize = 50
		offset := (page - 1) * pageSize

		people, err := db.ListPeople(r.Context(), pool, search, pageSize, offset)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		total, err := db.CountPeople(r.Context(), pool, search)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"people": people,
			"total":  total,
		})
	})

	// Person detail → JSON
	mux.HandleFunc("GET /api/person/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidRE.MatchString(id) {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		person, err := db.GetPerson(r.Context(), pool, id)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				jsonError(w, "not found", http.StatusNotFound)
				return
			}
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		father, mother, err := db.GetParents(r.Context(), pool, id)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		families, err := db.GetPersonFamilies(r.Context(), pool, id)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"person":   person,
			"father":   father,
			"mother":   mother,
			"families": families,
		})
	})

	// Ancestor tree JSON (consumed by D3 in the React tree component)
	mux.HandleFunc("GET /api/tree/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidRE.MatchString(id) {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		gens, _ := strconv.Atoi(r.URL.Query().Get("gen"))
		if gens < 1 {
			gens = db.MaxTreeGens
		}
		if gens > db.MaxTreeGens {
			gens = db.MaxTreeGens
		}
		root, err := db.BuildAncestorTree(r.Context(), pool, id, gens)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				jsonError(w, "not found", http.StatusNotFound)
				return
			}
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		data, err := db.MarshalTree(root)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(data)
	})

	// Health check (used by Traefik and CI)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// ── React SPA (catch-all) ─────────────────────────────────────────────────
	sub, err := fs.Sub(staticFiles, "frontend/dist")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		// Serve the exact asset if it exists; otherwise return index.html for SPA routing.
		if _, err := fs.Stat(sub, path); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	log.Printf("ancestry listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	writeJSON(w, status, map[string]string{"error": msg})
}
