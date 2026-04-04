package main

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
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

	editSecret := os.Getenv("EDIT_SECRET")
	checkAuth := func(r *http.Request) bool {
		if editSecret == "" {
			return false
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		return subtle.ConstantTimeCompare([]byte(token), []byte(editSecret)) == 1
	}

	mux := http.NewServeMux()

	// ── JSON API ──────────────────────────────────────────────────────────────

	// Default root person (gedcom_id I500001 = David Schmid, fallback to first person)
	mux.HandleFunc("GET /api/default-root", func(w http.ResponseWriter, r *http.Request) {
		var id string
		err := pool.QueryRow(r.Context(),
			`SELECT id::text FROM persons WHERE gedcom_id = 'I500001' LIMIT 1`).Scan(&id)
		if err != nil {
			err = pool.QueryRow(r.Context(),
				`SELECT id::text FROM persons ORDER BY last_name, first_name LIMIT 1`).Scan(&id)
			if err != nil {
				jsonError(w, "no persons found", http.StatusNotFound)
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id})
	})

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
		if families == nil {
			families = []db.FamilyView{}
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

	// Descendants tree (3 generations shown + 1 preloaded for +/− toggle)
	mux.HandleFunc("GET /api/descendants/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidRE.MatchString(id) {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		depth := 0 // unused – BuildDescendantTree is now fully recursive
		root, err := db.BuildDescendantTree(r.Context(), pool, id, depth)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				jsonError(w, "not found", http.StatusNotFound)
				return
			}
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, root)
	})

	// Siblings of a person
	mux.HandleFunc("GET /api/siblings/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidRE.MatchString(id) {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		siblings, err := db.GetSiblings(r.Context(), pool, id)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if siblings == nil {
			siblings = []*db.Person{}
		}
		writeJSON(w, http.StatusOK, siblings)
	})

	// Auth verify — returns 200 if secret is correct
	mux.HandleFunc("GET /api/auth/verify", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r) {
			jsonError(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	// Update person fields (auth required)
	mux.HandleFunc("PUT /api/person/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r) {
			jsonError(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		if !uuidRE.MatchString(id) {
			jsonError(w, "not found", http.StatusNotFound)
			return
		}
		var p db.Person
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			jsonError(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := db.UpdatePerson(r.Context(), pool, id, p); err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		updated, err := db.GetPerson(r.Context(), pool, id)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, updated)
	})

	// GEDCOM export
	mux.HandleFunc("GET /api/export/gedcom", func(w http.ResponseWriter, r *http.Request) {
		people, families, err := db.ExportAll(r.Context(), pool)
		if err != nil {
			jsonError(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/x-gedcom")
		w.Header().Set("Content-Disposition", `attachment; filename="family.ged"`)
		fmt.Fprintln(w, "0 HEAD")
		fmt.Fprintln(w, "1 GEDC")
		fmt.Fprintln(w, "2 VERS 5.5.1")
		fmt.Fprintln(w, "1 CHAR UTF-8")
		fmt.Fprintln(w, "1 SOUR ancestry.dawei7.com")
		for _, p := range people {
			gid := p.GedcomID
			if gid == "" {
				gid = p.ID
			}
			fmt.Fprintf(w, "0 @%s@ INDI\n", gid)
			if p.FirstName != "" || p.LastName != "" {
				fmt.Fprintf(w, "1 NAME %s /%s/\n", p.FirstName, p.LastName)
			}
			if p.MaidenName != "" {
				fmt.Fprintf(w, "1 NAME /%s/\n", p.MaidenName)
				fmt.Fprintln(w, "2 _MTYPE MAIDEN")
			}
			if p.Sex != "" {
				fmt.Fprintf(w, "1 SEX %s\n", p.Sex)
			}
			if p.BirthDate != "" || p.BirthPlace != "" {
				fmt.Fprintln(w, "1 BIRT")
				if p.BirthDate != "" {
					fmt.Fprintf(w, "2 DATE %s\n", p.BirthDate)
				}
				if p.BirthPlace != "" {
					fmt.Fprintf(w, "2 PLAC %s\n", p.BirthPlace)
				}
			}
			if p.DeathDate != "" || p.DeathPlace != "" {
				fmt.Fprintln(w, "1 DEAT")
				if p.DeathDate != "" {
					fmt.Fprintf(w, "2 DATE %s\n", p.DeathDate)
				}
				if p.DeathPlace != "" {
					fmt.Fprintf(w, "2 PLAC %s\n", p.DeathPlace)
				}
			}
			if p.BurialDate != "" || p.BurialPlace != "" {
				fmt.Fprintln(w, "1 BURI")
				if p.BurialDate != "" {
					fmt.Fprintf(w, "2 DATE %s\n", p.BurialDate)
				}
				if p.BurialPlace != "" {
					fmt.Fprintf(w, "2 PLAC %s\n", p.BurialPlace)
				}
			}
			if p.Occupation != "" {
				fmt.Fprintf(w, "1 OCCU %s\n", p.Occupation)
			}
			if p.Notes != "" {
				lines := strings.Split(p.Notes, "\n")
				for i, line := range lines {
					if i == 0 {
						fmt.Fprintf(w, "1 NOTE %s\n", line)
					} else {
						fmt.Fprintf(w, "2 CONT %s\n", line)
					}
				}
			}
		}
		for _, f := range families {
			gid := f.GedcomID
			if gid == "" {
				continue
			}
			fmt.Fprintf(w, "0 @%s@ FAM\n", gid)
			if f.HusbandGedcom != "" {
				fmt.Fprintf(w, "1 HUSB @%s@\n", f.HusbandGedcom)
			}
			if f.WifeGedcom != "" {
				fmt.Fprintf(w, "1 WIFE @%s@\n", f.WifeGedcom)
			}
			if f.MarriageDate != "" || f.MarriagePlace != "" {
				fmt.Fprintln(w, "1 MARR")
				if f.MarriageDate != "" {
					fmt.Fprintf(w, "2 DATE %s\n", f.MarriageDate)
				}
				if f.MarriagePlace != "" {
					fmt.Fprintf(w, "2 PLAC %s\n", f.MarriagePlace)
				}
			}
			if f.DivorceDate != "" || f.DivorcePlace != "" {
				fmt.Fprintln(w, "1 DIV")
				if f.DivorceDate != "" {
					fmt.Fprintf(w, "2 DATE %s\n", f.DivorceDate)
				}
				if f.DivorcePlace != "" {
					fmt.Fprintf(w, "2 PLAC %s\n", f.DivorcePlace)
				}
			}
			for _, c := range f.ChildGedcoms {
				fmt.Fprintf(w, "1 CHIL @%s@\n", c)
			}
		}
		fmt.Fprintln(w, "0 TRLR")
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
