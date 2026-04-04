package db

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TreeNode is a node in an ancestor pedigree tree.
type TreeNode struct {
	Person      *Person
	Father      *TreeNode
	Mother      *TreeNode
	HasSiblings bool
}

// NodeJSON is the D3-compatible JSON form of a pedigree tree node.
// "children" in D3 terms are the genealogical parents (ancestors branch right).
type NodeJSON struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Dates       string      `json:"dates,omitempty"`
	Sex         string      `json:"sex,omitempty"`
	HasSiblings bool        `json:"has_siblings,omitempty"`
	Children    []*NodeJSON `json:"children,omitempty"`
}

// TreeToJSON converts a TreeNode tree to a D3-compatible hierarchy.
func TreeToJSON(node *TreeNode) *NodeJSON {
	if node == nil {
		return nil
	}
	n := &NodeJSON{
		ID:          node.Person.ID,
		Name:        node.Person.FullName(),
		Dates:       treeDates(node.Person),
		Sex:         node.Person.Sex,
		HasSiblings: node.HasSiblings,
	}
	if node.Father != nil {
		n.Children = append(n.Children, TreeToJSON(node.Father))
	}
	if node.Mother != nil {
		n.Children = append(n.Children, TreeToJSON(node.Mother))
	}
	return n
}

// MarshalTree serialises a TreeNode to JSON bytes ready to write to a response.
func MarshalTree(node *TreeNode) ([]byte, error) {
	return json.Marshal(TreeToJSON(node))
}

const MaxTreeGens = 15

// ProbeAncestorDepth returns the actual deepest ancestor chain for personID,
// capped at maxCheck. It only queries parent IDs (no full person rows).
func ProbeAncestorDepth(ctx context.Context, pool *pgxpool.Pool, personID string, maxCheck int) (int, error) {
	return probeDepth(ctx, pool, personID, 1, maxCheck)
}

func probeDepth(ctx context.Context, pool *pgxpool.Pool, personID string, cur, max int) (int, error) {
	if cur >= max {
		return cur, nil
	}
	var husbandID, wifeID string
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(f.husband_id::text,''), COALESCE(f.wife_id::text,'')
 FROM families f
 JOIN family_children fc ON fc.family_id = f.id
 WHERE fc.person_id = $1::uuid
 LIMIT 1`, personID).Scan(&husbandID, &wifeID)
	if err != nil {
		return cur, nil
	}
	best := cur
	for _, pid := range []string{husbandID, wifeID} {
		if pid == "" {
			continue
		}
		d, err := probeDepth(ctx, pool, pid, cur+1, max)
		if err != nil {
			return 0, err
		}
		if d > best {
			best = d
		}
	}
	return best, nil
}

// BuildAncestorTree fetches a person and their ancestors up to depth generations.
// depth=1 returns only the subject; depth=4 gives subject+parents+grandparents+great-grandparents.
func BuildAncestorTree(ctx context.Context, pool *pgxpool.Pool, personID string, depth int) (*TreeNode, error) {
	person, err := GetPerson(ctx, pool, personID)
	if err != nil {
		return nil, err
	}
	node := &TreeNode{Person: person}
	node.HasSiblings, _ = hasSiblings(ctx, pool, personID)
	if depth <= 1 {
		return node, nil
	}
	father, mother, err := GetParents(ctx, pool, personID)
	if err != nil {
		return nil, err
	}
	if father != nil {
		node.Father, _ = BuildAncestorTree(ctx, pool, father.ID, depth-1)
	}
	if mother != nil {
		node.Mother, _ = BuildAncestorTree(ctx, pool, mother.ID, depth-1)
	}
	return node, nil
}

// BuildDescendantTree fetches a person and all their descendants recursively.
// visited prevents infinite loops from data cycles.
func BuildDescendantTree(ctx context.Context, pool *pgxpool.Pool, personID string, _ int) (*NodeJSON, error) {
	return buildDescTree(ctx, pool, personID, map[string]bool{})
}

func buildDescTree(ctx context.Context, pool *pgxpool.Pool, personID string, visited map[string]bool) (*NodeJSON, error) {
	if visited[personID] {
		return nil, nil
	}
	visited[personID] = true
	person, err := GetPerson(ctx, pool, personID)
	if err != nil {
		return nil, err
	}
	node := &NodeJSON{
		ID:    person.ID,
		Name:  person.FullName(),
		Dates: treeDates(person),
		Sex:   person.Sex,
	}
	node.HasSiblings, _ = hasSiblings(ctx, pool, personID)
	families, err := GetPersonFamilies(ctx, pool, personID)
	if err != nil {
		return nil, err
	}
	for _, fam := range families {
		for _, child := range fam.Children {
			childNode, childErr := buildDescTree(ctx, pool, child.ID, visited)
			if childErr != nil || childNode == nil {
				continue
			}
			node.Children = append(node.Children, childNode)
		}
	}
	return node, nil
}

func treeDates(p *Person) string {
	switch {
	case p.BirthDate != "" && p.DeathDate != "":
		return p.BirthDate + " – " + p.DeathDate
	case p.BirthDate != "":
		return "b. " + p.BirthDate
	case p.DeathDate != "":
		return "d. " + p.DeathDate
	}
	return ""
}
