require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const GHL_BASE = "https://services.leadconnectorhq.com";
const { GHL_TOKEN, CALENDAR_ID, LOCATION_ID } = process.env;

// Filtra slot: lun–ven (1..5), fasce 09–13 / 15–18
function slotConsentito(isoString) {
  // Assumiamo che GHL risponda coerente col timezone richiesto.
  const d = new Date(isoString);
  const day = d.getDay();    // 0=Dom .. 6=Sab
  const hour = d.getHours(); // 0-23
  const feriale = day >= 1 && day <= 5;
  const mattina = hour >= 9 && hour < 13;
  const pomeriggio = hour >= 15 && hour < 18;
  return feriale && (mattina || pomeriggio);
}

// Healthcheck
app.get("/health", (_, res) => res.send("ok"));

/**
 * POST /retell/get-free-slots
 * Body (opzionale):
 * {
 *   "startDate": "2025-10-03",  // oppure ISO completo; se omesso = oggi
 *   "days": 14                  // estensione finestra
 * }
 */
app.post("/retell/get-free-slots", async (req, res) => {
  try {
    const { startDate, days = 14 } = req.body || {};

    // Converte "YYYY-MM-DD" o ISO in Date; se non fornita, oggi
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + Number(days));

    // ⚠️ GHL richiede startDate/endDate in epoch millisecondi
    const params = {
      startDate: start.getTime(),
      endDate: end.getTime(),
      timezone: "Europe/Rome"
    };

    const headers = {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Accept: "application/json",
      Version: "2021-07-28"
    };

    console.log(">> GET free-slots params:", params);

    const url = `${GHL_BASE}/calendars/${CALENDAR_ID}/free-slots`;
    const { data } = await axios.get(url, { params, headers });

    // Normalizza risposta: { slots: [...] } oppure direttamente [...]
    const rawSlots = Array.isArray(data) ? data : (data?.slots || []);
    const filtered = rawSlots
      .filter(s => s?.startTime && slotConsentito(s.startTime))
      .slice(0, 3);

    return res.json({
      calendarId: CALENDAR_ID,
      timezone: "Europe/Rome",
      slots: filtered
    });
  } catch (err) {
    const status = err?.response?.status || 500;
    const payload = err?.response?.data || { message: err.message };
    console.error("free-slots error:", payload);
    return res.status(status).json({ error: "GHL error on free-slots", detail: payload });
  }
});

/**
 * POST /retell/book-appointment
 * Body:
 * {
 *   "name": "Mario Rossi",
 *   "email": "mario@example.com",
 *   "phone": "+39333...",
 *   "startTime": "2025-10-07T09:00:00+02:00", // ISO con offset (Roma)
 *   "endTime":   "2025-10-07T09:30:00+02:00",
 *   "title": "Appuntamento"                    // opzionale
 * }
 */
app.post("/retell/book-appointment", async (req, res) => {
  try {
    const { name, email, phone, startTime, endTime, title = "Appuntamento" } = req.body || {};
    if (!startTime || !endTime) {
      return res.status(400).json({ error: "startTime ed endTime sono obbligatori (ISO con offset)" });
    }

    const headers = {
      Authorization: `Bearer ${GHL_TOKEN}`,
      "Content-Type": "application/json",
      Version: "2021-07-28"
    };

    // 1) Upsert contatto per ottenere contactId
    const upsertResp = await axios.post(
      `${GHL_BASE}/contacts/upsert`,
      { name, email, phone, locationId: LOCATION_ID },
      { headers }
    );

    const contactId =
      upsertResp?.data?.contact?.id ||
      upsertResp?.data?.id ||
      upsertResp?.data?.contactId;

    if (!contactId) {
      return res.status(502).json({ error: "GHL upsert contact: id mancante", detail: upsertResp?.data });
    }

    // 2) Crea appuntamento
    const createResp = await axios.post(
      `${GHL_BASE}/calendars/events/appointments`,
      { calendarId: CALENDAR_ID, locationId: LOCATION_ID, contactId, startTime, endTime, title },
      { headers }
    );

    return res.json({ ok: true, appointment: createResp.data });
  } catch (err) {
    const status = err?.response?.status || 500;
    const payload = err?.response?.data || { message: err.message };
    console.error("book-appointment error:", payload);
    return res.status(status).json({ error: "GHL error on book-appointment", detail: payload });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge attivo su :${PORT}`));
