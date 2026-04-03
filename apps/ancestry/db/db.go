package db

import (
	"context"
	"errors"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Person holds a single person record.
type Person struct {
	ID         string `json:"id"`
	GedcomID   string `json:"gedcom_id"`
	FirstName  string `json:"first_name"`
	LastName   string `json:"last_name"`
	MaidenName string `json:"maiden_name"`
	Sex        string `json:"sex"`
	BirthDate  string `json:"birth_date"`
	BirthPlace string `json:"birth_place"`
	DeathDate  string `json:"death_date"`
	DeathPlace string `json:"death_place"`
	Notes      string `json:"notes"`
}

// FullName returns "First Last", falling back to whichever part is available.
func (p Person) FullName() string {
	switch {
	case p.FirstName == "":
		return p.LastName
	case p.LastName == "":
		return p.FirstName
	default:
		return p.FirstName + " " + p.LastName
	}
}

// FamilyView represents a spousal family unit (spouse + children).
type FamilyView struct {
	Spouse        *Person  `json:"spouse"`
	MarriageDate  string   `json:"marriage_date"`
	MarriagePlace string   `json:"marriage_place"`
	Children      []Person `json:"children"`
}

// ErrNotFound is returned when a record doesn't exist.
var ErrNotFound = errors.New("not found")

// scanner is satisfied by both pgx.Row and pgx.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanPerson(s scanner) (Person, error) {
	var p Person
	err := s.Scan(
		&p.ID, &p.GedcomID, &p.FirstName, &p.LastName, &p.MaidenName,
		&p.Sex, &p.BirthDate, &p.BirthPlace, &p.DeathDate, &p.DeathPlace, &p.Notes,
	)
	return p, err
}

const personCols = `id::text,
	COALESCE(gedcom_id,''), COALESCE(first_name,''), COALESCE(last_name,''),
	COALESCE(maiden_name,''), COALESCE(sex,''), COALESCE(birth_date,''),
	COALESCE(birth_place,''), COALESCE(death_date,''), COALESCE(death_place,''),
	COALESCE(notes,'')`

const personColsP = `p.id::text,
	COALESCE(p.gedcom_id,''), COALESCE(p.first_name,''), COALESCE(p.last_name,''),
	COALESCE(p.maiden_name,''), COALESCE(p.sex,''), COALESCE(p.birth_date,''),
	COALESCE(p.birth_place,''), COALESCE(p.death_date,''), COALESCE(p.death_place,''),
	COALESCE(p.notes,'')`

// Connect creates a pgx connection pool from DATABASE_URL.
func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
}

// CountPeople returns the total matching a search term (empty = all).
func CountPeople(ctx context.Context, pool *pgxpool.Pool, search string) (int, error) {
	var count int
	var err error
	if search != "" {
		err = pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM persons
			 WHERE first_name ILIKE '%'||$1||'%' OR last_name ILIKE '%'||$1||'%'`,
			search).Scan(&count)
	} else {
		err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM persons`).Scan(&count)
	}
	return count, err
}

// ListPeople returns a paginated, optionally filtered list ordered by name.
func ListPeople(ctx context.Context, pool *pgxpool.Pool, search string, limit, offset int) ([]Person, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if search != "" {
		rows, err = pool.Query(ctx,
			`SELECT `+personCols+`
			 FROM persons
			 WHERE first_name ILIKE '%'||$1||'%' OR last_name ILIKE '%'||$1||'%'
			 ORDER BY last_name, first_name
			 LIMIT $2 OFFSET $3`,
			search, limit, offset)
	} else {
		rows, err = pool.Query(ctx,
			`SELECT `+personCols+`
			 FROM persons
			 ORDER BY last_name, first_name
			 LIMIT $1 OFFSET $2`,
			limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var people []Person
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			return nil, err
		}
		people = append(people, p)
	}
	return people, rows.Err()
}

// GetPerson fetches a single person by UUID string.
func GetPerson(ctx context.Context, pool *pgxpool.Pool, id string) (*Person, error) {
	p, err := scanPerson(pool.QueryRow(ctx,
		`SELECT `+personCols+`
		 FROM persons WHERE id = $1::uuid`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// GetParents returns the father and mother of a person (nil if unknown).
func GetParents(ctx context.Context, pool *pgxpool.Pool, personID string) (father, mother *Person, err error) {
	var husbandID, wifeID string
	err = pool.QueryRow(ctx,
		`SELECT COALESCE(f.husband_id::text,''), COALESCE(f.wife_id::text,'')
		 FROM families f
		 JOIN family_children fc ON fc.family_id = f.id
		 WHERE fc.person_id = $1::uuid
		 LIMIT 1`, personID).Scan(&husbandID, &wifeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	if husbandID != "" {
		father, _ = GetPerson(ctx, pool, husbandID)
	}
	if wifeID != "" {
		mother, _ = GetPerson(ctx, pool, wifeID)
	}
	return father, mother, nil
}

// GetPersonFamilies returns families where the person appears as a spouse.
func GetPersonFamilies(ctx context.Context, pool *pgxpool.Pool, personID string) ([]FamilyView, error) {
	rows, err := pool.Query(ctx,
		`SELECT f.id::text,
			COALESCE(f.husband_id::text,''), COALESCE(f.wife_id::text,''),
			COALESCE(f.marriage_date,''), COALESCE(f.marriage_place,'')
		 FROM families f
		 WHERE f.husband_id = $1::uuid OR f.wife_id = $1::uuid
		 ORDER BY f.marriage_date`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var families []FamilyView
	for rows.Next() {
		var famID, husbandID, wifeID, marDate, marPlace string
		if err := rows.Scan(&famID, &husbandID, &wifeID, &marDate, &marPlace); err != nil {
			return nil, err
		}
		fv := FamilyView{MarriageDate: marDate, MarriagePlace: marPlace}

		spouseID := wifeID
		if personID == wifeID {
			spouseID = husbandID
		}
		if spouseID != "" {
			fv.Spouse, _ = GetPerson(ctx, pool, spouseID)
		}

		childRows, cerr := pool.Query(ctx,
			`SELECT `+personColsP+`
			 FROM family_children fc
			 JOIN persons p ON p.id = fc.person_id
			 WHERE fc.family_id = $1::uuid
			 ORDER BY p.birth_date, p.last_name`, famID)
		if cerr != nil {
			return nil, cerr
		}
		for childRows.Next() {
			child, err := scanPerson(childRows)
			if err != nil {
				childRows.Close()
				return nil, err
			}
			fv.Children = append(fv.Children, child)
		}
		childRows.Close()
		if err := childRows.Err(); err != nil {
			return nil, err
		}
		families = append(families, fv)
	}
	return families, rows.Err()
}
