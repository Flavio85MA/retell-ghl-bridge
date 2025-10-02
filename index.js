require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const GHL_BASE = "https://services.leadconnectorhq.com";
const { GHL_TOKEN, CALENDAR_ID, LOCATION_ID } = process.env;

// Healthcheck
app.get("/health", (_, res) => res.send("ok"));

/**
 * POST /retell/get-free-slots
 * Body (opzionale):
 * {
 *   "startDate": "2025-10-03",
 *   "days": 14
 * }
 */
app.post("/retell/get-free-slots", async (req, res) => {
  try {
    const { startDate, days = 14 } = req.body || {};

    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + Number(days));

    // ⚠️ GHL vuole startDate/endDate in epoch millisecondi
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

    // 👀 Log completo della risposta GHL nei log di Render
    console.log(">> GHL free-slots response:", JSON.stringify(data, null, 2));

    const rawSlots = Array.isArray(data) ? data : (data?.slots || []);

    // 👉 Mostriamo TUTTO senza filtro (primi 10 slot max)
    return res.json({
      calendarId: CALENDAR_ID,
      timezone: "Europe/Rome",
      slots: rawSlots.slice(0, 10)
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
 *   "startTime": "2025-10-07T09:00:00+02:00",
 *   "endTime":   "2025-10-07T09:30:00+02:00",
 *   "title": "Appuntamento"
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

    // 1) Upsert contatto
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
