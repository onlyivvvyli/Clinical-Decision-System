CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prescription_logs (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL,
  patient_id TEXT NOT NULL,
  medication_name TEXT NOT NULL,
  medication_code TEXT NOT NULL,
  decision TEXT NOT NULL,
  alert_summary TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO doctors (id, username, password, name)
VALUES (1, 'doctor1', '123456', 'Dr. Demo');
