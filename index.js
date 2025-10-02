require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const GHL_BASE = "https://services.leadconnectorhq.com";
const { GHL_TOKEN, CALENDAR_ID, LOCATION_ID } = process.env;

// Funzione per filtrare solo slot lun-ven, 09–13 e 15–18
function slotConsentito(isoString) {
  const d = new Date(isoString);
  const day = d.getDay();    // 0=Dom, 6=Sab
  const hour = d.getHours(); // 0–23
  const feriale = day >= 1 && day <= 5;
  const mattina = hour >= 9 && hour < 13;
  const pomeriggio = hour >= 15 && hour < 18;
  return feriale && (mattina || pomeriggio);
}

// Endpoint test
app.get("/health", (_, res) => res.send("ok"));

// Recupera slot liberi
app.post("/retell/get-free-slots", async (req, res) => {
  try {
    const { startDate, days = 14 } = req.body || {};
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + Number(days));

    const params = {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: "Europe/Rome"
    };

    const headers = {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Accept: "application/json"
    };

    const url = `${GHL_BASE}/calendars/${CALENDAR_ID}/free-slots`;
    const { data } = await axios.get(url, { params, headers });

    const rawSlots = Array.isArray(data) ? data : (data?.slots || []);
    const filtered = rawSlots.filter(s => slotConsentito(s.startTime)).slice(0, 3);

    res.json({ calendarId: CALENDAR_ID, timezone: "Europe/Rome", slots: filtered });
  } catch (err) {
    console.error("free-slots error:", err?.response?.data || err.message);
    res.status(500).json({ error: "Impossibile recuperare gli slot liberi" });
  }
});

// Crea appuntamento
app.post("/retell/book-appointment", async (req, res) => {
  try {
    const { name, email, phone, startTime, endTime, title = "Appuntamento" } = req.body || {};
    if (!startTime || !endTime) return res.status(400).json({ error: "startTime e endTime obbligatori" });

    const headers = {
      Authorization: `Bearer ${GHL_TOKEN}`,
      "Content-Type": "application/json"
    };

    // 1. Upsert contatto
    const upsertResp = await axios.post(
      `${GHL_BASE}/contacts/upsert`,
      { name, email, phone, locationId: LOCATION_ID },
      { headers }
    );
    const contactId = upsertResp?.data?.contact?.id || upsertResp?.data?.id;
    if (!contactId) return res.status(500).json({ error: "Impossibile ottenere contactId" });

    // 2. Crea appuntamento
    const createResp = await axios.post(
      `${GHL_BASE}/calendars/events/appointments`,
      { calendarId: CALENDAR_ID, locationId: LOCATION_ID, contactId, startTime, endTime, title },
      { headers }
    );

    res.json({ ok: true, appointment: createResp.data });
  } catch (err) {
    console.error("book-appointment error:", err?.response?.data || err.message);
    res.status(500).json({ error: "Impossibile creare l'appuntamento" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge attivo su :${PORT}`));
