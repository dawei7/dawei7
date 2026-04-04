package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Person holds a single person record.
type Person struct {
	ID          string `json:"id"`
	GedcomID    string `json:"gedcom_id"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	MaidenName  string `json:"maiden_name"`
	Sex         string `json:"sex"`
	BirthDate   string `json:"birth_date"`
	BirthPlace  string `json:"birth_place"`
	DeathDate   string `json:"death_date"`
	DeathPlace  string `json:"death_place"`
	BurialDate  string `json:"burial_date"`
	BurialPlace string `json:"burial_place"`
	Occupation  string `json:"occupation"`
	Notes       string `json:"notes"`
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
	DivorceDate   string   `json:"divorce_date"`
	DivorcePlace  string   `json:"divorce_place"`
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
		&p.Sex, &p.BirthDate, &p.BirthPlace, &p.DeathDate, &p.DeathPlace,
		&p.BurialDate, &p.BurialPlace, &p.Occupation, &p.Notes,
	)
	return p, err
}

const personCols = `id::text,
	COALESCE(gedcom_id,''), COALESCE(first_name,''), COALESCE(last_name,''),
	COALESCE(maiden_name,''), COALESCE(sex,''), COALESCE(birth_date,''),
	COALESCE(birth_place,''), COALESCE(death_date,''), COALESCE(death_place,''),
	COALESCE(burial_date,''), COALESCE(burial_place,''), COALESCE(occupation,''),
	COALESCE(notes,'')`

const personColsP = `p.id::text,
	COALESCE(p.gedcom_id,''), COALESCE(p.first_name,''), COALESCE(p.last_name,''),
	COALESCE(p.maiden_name,''), COALESCE(p.sex,''), COALESCE(p.birth_date,''),
	COALESCE(p.birth_place,''), COALESCE(p.death_date,''), COALESCE(p.death_place,''),
	COALESCE(p.burial_date,''), COALESCE(p.burial_place,''), COALESCE(p.occupation,''),
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
		words := strings.Fields(search)
		args := make([]any, len(words))
		conds := make([]string, len(words))
		for i, w := range words {
			args[i] = "%" + w + "%"
			conds[i] = fmt.Sprintf("(first_name ILIKE $%d OR last_name ILIKE $%d)", i+1, i+1)
		}
		q := "SELECT COUNT(*) FROM persons WHERE " + strings.Join(conds, " AND ")
		err = pool.QueryRow(ctx, q, args...).Scan(&count)
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
		words := strings.Fields(search)
		conds := make([]string, len(words))
		args := make([]any, len(words)+2)
		for i, w := range words {
			args[i] = "%" + w + "%"
			conds[i] = fmt.Sprintf("(first_name ILIKE $%d OR last_name ILIKE $%d)", i+1, i+1)
		}
		args[len(words)] = limit
		args[len(words)+1] = offset
		q := `SELECT ` + personCols + ` FROM persons WHERE ` + strings.Join(conds, " AND ") +
			fmt.Sprintf(` ORDER BY last_name, first_name LIMIT $%d OFFSET $%d`, len(words)+1, len(words)+2)
		rows, err = pool.Query(ctx, q, args...)
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

// hasSiblings returns true if personID shares a parent family with at least one other child.
func hasSiblings(ctx context.Context, pool *pgxpool.Pool, personID string) (bool, error) {
	var has bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM family_children fc
			WHERE fc.family_id IN (
				SELECT family_id FROM family_children WHERE person_id = $1::uuid
			)
			AND fc.person_id != $1::uuid
		)`, personID).Scan(&has)
	return has, err
}

// GetSiblings returns all other children of the same parent family as personID.
func GetSiblings(ctx context.Context, pool *pgxpool.Pool, personID string) ([]*Person, error) {
	// Find the family this person is a child of
	var famID string
	err := pool.QueryRow(ctx,
		`SELECT family_id::text FROM family_children WHERE person_id = $1::uuid LIMIT 1`,
		personID).Scan(&famID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	// Fetch all children of that family except the person themselves
	rows, err := pool.Query(ctx,
		`SELECT `+personCols+`
		 FROM persons p
		 JOIN family_children fc ON fc.person_id = p.id
		 WHERE fc.family_id = $1::uuid AND p.id != $2::uuid
		 ORDER BY p.birth_date NULLS LAST, p.first_name`,
		famID, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var siblings []*Person
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			return nil, err
		}
		siblings = append(siblings, &p)
	}
	return siblings, rows.Err()
}

// GetPersonFamilies returns families where the person appears as a spouse.
func GetPersonFamilies(ctx context.Context, pool *pgxpool.Pool, personID string) ([]FamilyView, error) {
	rows, err := pool.Query(ctx,
		`SELECT f.id::text,
			COALESCE(f.husband_id::text,''), COALESCE(f.wife_id::text,''),
			COALESCE(f.marriage_date,''), COALESCE(f.marriage_place,''),
			COALESCE(f.divorce_date,''), COALESCE(f.divorce_place,'')
		 FROM families f
		 WHERE f.husband_id = $1::uuid OR f.wife_id = $1::uuid
		 ORDER BY f.marriage_date`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var families []FamilyView
	for rows.Next() {
		var famID, husbandID, wifeID, marDate, marPlace, divDate, divPlace string
		if err := rows.Scan(&famID, &husbandID, &wifeID, &marDate, &marPlace, &divDate, &divPlace); err != nil {
			return nil, err
		}
		fv := FamilyView{MarriageDate: marDate, MarriagePlace: marPlace, DivorceDate: divDate, DivorcePlace: divPlace}

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

// UpdatePerson overwrites all editable fields on a person record.
func UpdatePerson(ctx context.Context, pool *pgxpool.Pool, id string, p Person) error {
	ns := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	_, err := pool.Exec(ctx, `
		UPDATE persons SET
			first_name   = $1,  last_name   = $2,  maiden_name = $3,
			sex          = $4,
			birth_date   = $5,  birth_place = $6,
			death_date   = $7,  death_place = $8,
			burial_date  = $9,  burial_place = $10,
			occupation   = $11, notes       = $12
		WHERE id = $13::uuid`,
		ns(p.FirstName), ns(p.LastName), ns(p.MaidenName), ns(p.Sex),
		ns(p.BirthDate), ns(p.BirthPlace),
		ns(p.DeathDate), ns(p.DeathPlace),
		ns(p.BurialDate), ns(p.BurialPlace),
		ns(p.Occupation), ns(p.Notes),
		id,
	)
	return err
}

// ExportRow is a flat row used for GEDCOM generation.
type ExportRow struct {
	Person   Person
	Families []FamilyExport
}

// FamilyExport holds a family record for GEDCOM export.
type FamilyExport struct {
	GedcomID      string
	HusbandGedcom string
	WifeGedcom    string
	MarriageDate  string
	MarriagePlace string
	DivorceDate   string
	DivorcePlace  string
	ChildGedcoms  []string
}

// ExportAll returns all persons and families for GEDCOM export.
func ExportAll(ctx context.Context, pool *pgxpool.Pool) ([]Person, []FamilyExport, error) {
	rows, err := pool.Query(ctx, `SELECT `+personCols+` FROM persons ORDER BY last_name, first_name`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var people []Person
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			return nil, nil, err
		}
		people = append(people, p)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	famRows, err := pool.Query(ctx, `
		SELECT f.gedcom_id,
			COALESCE(h.gedcom_id,''), COALESCE(w.gedcom_id,''),
			COALESCE(f.marriage_date,''), COALESCE(f.marriage_place,''),
			COALESCE(f.divorce_date,''), COALESCE(f.divorce_place,'')
		FROM families f
		LEFT JOIN persons h ON h.id = f.husband_id
		LEFT JOIN persons w ON w.id = f.wife_id
		ORDER BY f.marriage_date`)
	if err != nil {
		return nil, nil, err
	}
	defer famRows.Close()

	var families []FamilyExport
	for famRows.Next() {
		var fe FamilyExport
		var famGedcomID string
		if err := famRows.Scan(&famGedcomID, &fe.HusbandGedcom, &fe.WifeGedcom,
			&fe.MarriageDate, &fe.MarriagePlace, &fe.DivorceDate, &fe.DivorcePlace); err != nil {
			return nil, nil, err
		}
		fe.GedcomID = famGedcomID

		crows, err := pool.Query(ctx, `
			SELECT COALESCE(p.gedcom_id,'')
			FROM family_children fc
			JOIN persons p ON p.id = fc.person_id
			WHERE fc.family_id = (SELECT id FROM families WHERE gedcom_id = $1)
			ORDER BY p.birth_date`, famGedcomID)
		if err != nil {
			return nil, nil, err
		}
		for crows.Next() {
			var cGedcom string
			if err := crows.Scan(&cGedcom); err != nil {
				crows.Close()
				return nil, nil, err
			}
			if cGedcom != "" {
				fe.ChildGedcoms = append(fe.ChildGedcoms, cGedcom)
			}
		}
		crows.Close()
		families = append(families, fe)
	}
	return people, families, famRows.Err()
}
