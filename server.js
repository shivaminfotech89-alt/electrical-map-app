import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- storage paths (file-based DB) ----
const DATA_DIR = path.join(__dirname, "data");
const STORE = path.join(DATA_DIR, "maps.json");

// ensure data folder + file exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, JSON.stringify({ lastId: 0, items: [] }, null, 2));

function loadStore() {
  const raw = fs.readFileSync(STORE, "utf-8");
  return JSON.parse(raw || '{"lastId":0,"items":[]}');
}
function saveStore(db) {
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---- API: save (create/update), list, load, delete ----

// Create or Update
app.post("/api/maps", (req, res) => {
  try {
    const { id, title, data } = req.body || {};
    if (!title || !data) return res.status(400).json({ error: "title and data required" });

    const db = loadStore();
    let item;

    if (id != null) {
      // update existing
      const idx = db.items.findIndex((x) => x.id === Number(id));
      if (idx === -1) return res.status(404).json({ error: "map not found" });
      item = { ...db.items[idx], title, data, updatedAt: new Date().toISOString() };
      db.items[idx] = item;
    } else {
      // create new
      const newId = ++db.lastId;
      item = { id: newId, title, data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.items.push(item);
    }

    saveStore(db);
    res.json({ id: item.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to save map" });
  }
});

// List (id + title only)
app.get("/api/maps", (req, res) => {
  try {
    const db = loadStore();
    const list = db.items
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    res.json({ items: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to list maps" });
  }
});

// Load one
app.get("/api/maps/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = loadStore();
    const item = db.items.find((x) => x.id === id);
    if (!item) return res.status(404).json({ error: "map not found" });
    res.json(item);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to load map" });
  }
});

// Delete
app.delete("/api/maps/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = loadStore();
    const idx = db.items.findIndex((x) => x.id === id);
    if (idx === -1) return res.status(404).json({ error: "map not found" });
    db.items.splice(idx, 1);
    saveStore(db);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to delete map" });
  }
});

// ---- static files ----
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
