// scripts/lib/db.mjs
// SQLite archive. Stores every article we have ever seen (for dedup + NEW/UPDATED/ONGOING
// tagging across editions) and a record of every published edition.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path = 'data/news.db') {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id            TEXT PRIMARY KEY,      -- stable hash of canonical url|title
      cluster_id    TEXT,                  -- dedup cluster (story) id
      title         TEXT NOT NULL,
      url           TEXT NOT NULL,
      source        TEXT,
      section       TEXT,
      subsection    TEXT,
      geo           TEXT,
      published_at  TEXT,                  -- ISO
      summary       TEXT,
      score         REAL,
      flags         TEXT,                  -- JSON array
      tone          TEXT,                  -- positive | negative | neutral
      first_seen    TEXT,                  -- ISO, first edition we saw it
      last_seen     TEXT,                  -- ISO, most recent edition
      seen_count    INTEGER DEFAULT 1,
      content_hash  TEXT                   -- detect material updates
    );
    CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);
    CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(section);

    CREATE TABLE IF NOT EXISTS editions (
      id           TEXT PRIMARY KEY,       -- e.g. 2026-06-03-morning
      label        TEXT,                   -- Morning | Midday | Evening
      created_at   TEXT,                   -- ISO
      story_count  INTEGER,
      path         TEXT                    -- public/data/editions/<id>.json
    );
  `);
  return db;
}

export function getArticle(db, id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

export function upsertArticle(db, a) {
  const existing = getArticle(db, a.id);
  if (!existing) {
    db.prepare(`INSERT INTO articles
      (id,cluster_id,title,url,source,section,subsection,geo,published_at,summary,score,flags,tone,first_seen,last_seen,seen_count,content_hash)
      VALUES (@id,@cluster_id,@title,@url,@source,@section,@subsection,@geo,@published_at,@summary,@score,@flags,@tone,@first_seen,@last_seen,1,@content_hash)`)
      .run(a);
    return { status: 'NEW' };
  }
  const materiallyChanged = existing.content_hash !== a.content_hash;
  db.prepare(`UPDATE articles SET
      title=@title, summary=@summary, score=@score, flags=@flags, tone=@tone,
      last_seen=@last_seen, seen_count=seen_count+1, content_hash=@content_hash,
      cluster_id=@cluster_id WHERE id=@id`).run(a);
  return { status: materiallyChanged ? 'UPDATED' : 'ONGOING', firstSeen: existing.first_seen };
}

export function recordEdition(db, e) {
  db.prepare(`INSERT OR REPLACE INTO editions (id,label,created_at,story_count,path)
              VALUES (@id,@label,@created_at,@story_count,@path)`).run(e);
}

export function listEditions(db, limit = 60) {
  return db.prepare('SELECT * FROM editions ORDER BY created_at DESC LIMIT ?').all(limit);
}
