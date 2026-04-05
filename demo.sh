#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# MongoBranch Interactive Demo — Feel the System
# ═══════════════════════════════════════════════════════════════
#
# Run: bash demo.sh
#
# This walks you through the full git-for-MongoDB experience:
#   1. Seed data → 2. Branch → 3. Modify → 4. Diff → 5. Merge
#
# Prerequisites:
#   - Atlas Local Docker running (port 27017 or 27018)
#   - bun installed
# ═══════════════════════════════════════════════════════════════

set -e
cd "$(dirname "$0")"

# Auto-detect Atlas Local port (27017 default, 27018 legacy/custom fallback)
if mongosh "mongodb://localhost:27017/?directConnection=true" --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
  PORT=27017
elif mongosh "mongodb://localhost:27018/?directConnection=true" --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
  PORT=27018
else
  echo "❌ No MongoDB found on port 27017 or 27018."
  echo "   Run: docker compose up -d"
  exit 1
fi

export MONGOBRANCH_URI="mongodb://localhost:${PORT}/?directConnection=true"
echo "  📡 Found Atlas Local on port ${PORT}"

MB="bun src/cli.ts"
SEP="════════════════════════════════════════════════════"

pause() {
  echo ""
  echo "  ⏎  Press Enter to continue..."
  read -r
}

echo "$SEP"
echo "  🌿 MongoBranch Demo — Git for MongoDB"
echo "$SEP"
echo ""
echo "  Your MongoDB has an ecommerce_app database with"
echo "  users, products, and orders. Let's branch it."
pause

# ── Step 1: List branches ──────────────────────────────────
echo ""
echo "$SEP"
echo "  Step 1: List branches"
echo "$SEP"
echo "  \$ mb branch list"
$MB branch list
pause

# ── Step 2: Create a feature branch ────────────────────────
echo ""
echo "$SEP"
echo "  Step 2: Create a branch (copies all data)"
echo "$SEP"
echo "  \$ mb branch create pricing-experiment"
$MB branch create pricing-experiment
pause

# ── Step 3: Show branches ─────────────────────────────────
echo ""
echo "$SEP"
echo "  Step 3: See our branches"
echo "$SEP"
echo "  \$ mb branch list"
$MB branch list
pause

# ── Step 4: Make changes on the branch ─────────────────────
echo ""
echo "$SEP"
echo "  Step 4: Modify data on the branch (via mongosh)"
echo "$SEP"
echo ""
echo "  We'll update product prices on the branch database."
echo "  Branch DB name: __mb_pricing-experiment"
echo ""

mongosh "mongodb://localhost:${PORT}/__mb_pricing-experiment?directConnection=true" --quiet --eval '
  // Double all product prices on this branch
  var result = db.products.updateMany({}, [{$set: {price: {$multiply: ["$price", 2]}}}]);
  print("Updated " + result.modifiedCount + " products (doubled prices)");

  // Add a new product only on the branch
  db.products.insertOne({_id: "demo-new-product", name: "AI Widget Pro", price: 99.99, category: "AI", inStock: true});
  print("Inserted new product: AI Widget Pro");
'
pause

# ── Step 5: Diff ───────────────────────────────────────────
echo ""
echo "$SEP"
echo "  Step 5: See what changed (diff)"
echo "$SEP"
echo "  \$ mb diff pricing-experiment"
$MB diff pricing-experiment
pause

# ── Step 6: Commit ─────────────────────────────────────────
echo ""
echo "$SEP"
echo "  Step 6: Commit the changes"
echo "$SEP"
echo "  \$ mb commit pricing-experiment -m 'Double prices + add AI Widget'"
$MB commit pricing-experiment -m "Double prices + add AI Widget"
pause

# ── Step 7: View commit log ────────────────────────────────
echo ""
echo "$SEP"
echo "  Step 7: View commit history"
echo "$SEP"
echo "  \$ mb commits pricing-experiment"
$MB commits pricing-experiment
pause

# ── Step 8: Merge back to main ─────────────────────────────
echo ""
echo "$SEP"
echo "  Step 8: Merge branch → main"
echo "$SEP"
echo "  \$ mb merge pricing-experiment"
$MB merge pricing-experiment
pause

# ── Step 9: Verify merge — check main has the new product ─
echo ""
echo "$SEP"
echo "  Step 9: Verify — new product is on main"
echo "$SEP"
mongosh "mongodb://localhost:${PORT}/ecommerce_app?directConnection=true" --quiet --eval '
  var doc = db.products.findOne({_id: "demo-new-product"});
  if (doc) { print("✅ Found on main: " + doc.name + " ($" + doc.price + ")"); }
  else { print("❌ Product not found on main"); }
'
pause

# ── Step 10: Clean up ─────────────────────────────────────
echo ""
echo "$SEP"
echo "  Step 10: Delete the branch"
echo "$SEP"
echo "  \$ mb branch delete pricing-experiment -y"
$MB branch delete pricing-experiment -y
pause

# ── Done ──────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "  ✅ Demo Complete!"
echo "$SEP"
echo ""
echo "  You just experienced the full MongoBranch workflow:"
echo "    branch → modify → diff → commit → merge → delete"
echo ""
echo "  Other things to try:"
echo "    mb stash push <branch>        — stash uncommitted changes"
echo "    mb compare <b1> <b2> <b3>     — N-way branch comparison"
echo "    mb reflog                     — see all branch pointer moves"
echo "    mb search-index list main     — list Atlas Search indexes"
echo "    mb agent register <name>      — register an AI agent"
echo "    mb deploy open <branch>       — open a deploy request"
echo "    mb anonymize <branch> <coll>  — PII anonymization"
echo ""
echo "  MCP Server (for AI agents):"
echo "    bun src/mcp/server.ts"
echo ""
echo "  Run all 224 tests:"
echo "    bun test"
echo ""
