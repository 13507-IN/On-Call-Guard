// ---------------------------------------------------------------------------
// Incident Store – in-memory store shared by the monitor service & API gateway
// ---------------------------------------------------------------------------

import { v4 as uuidv4 } from 'uuid';

/** Statuses that count as "still active" when checking for duplicates. */
const ACTIVE_STATUSES = new Set(['open', 'investigating', 'recovering']);

/**
 * Factory – creates an independent incident store instance.
 * Useful in tests so each suite gets its own isolated state.
 *
 * @returns {object} incident store API
 */
export function createIncidentStore() {
  /** @type {Array<object>} */
  const incidents = [];

  // ---- helpers ------------------------------------------------------------

  /**
   * Build a timeline entry with a timestamp.
   *
   * @param {string} event   - short event label (e.g. "created", "status_change")
   * @param {string} detail  - human-readable description
   * @returns {{ timestamp: string, event: string, detail: string }}
   */
  function _timelineEntry(event, detail) {
    return {
      timestamp: new Date().toISOString(),
      event,
      detail,
    };
  }

  // ---- public API ---------------------------------------------------------

  /**
   * Return every incident, most-recent first (by `createdAt`).
   *
   * @returns {Array<object>}
   */
  function getAll() {
    return [...incidents].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
  }

  /**
   * Look up a single incident by its id.
   *
   * @param {string} id
   * @returns {object|undefined}
   */
  function getById(id) {
    return incidents.find((inc) => inc.id === id);
  }

  /**
   * Return the first active (open / investigating / recovering) incident that
   * belongs to the given appId, or `undefined` if none exists.
   * This is used for duplicate-prevention – the monitor should not open a new
   * incident when one is already being tracked for the same application.
   *
   * @param {string} appId
   * @returns {object|undefined}
   */
  function getOpenByAppId(appId) {
    return incidents.find(
      (inc) => inc.appId === appId && ACTIVE_STATUSES.has(inc.status),
    );
  }

  /**
   * Persist a new incident.
   * Missing fields are populated with sensible defaults; an `id` is generated
   * when one is not supplied.
   *
   * @param {object} incident
   * @returns {object} the stored incident (with defaults applied)
   */
  function create(incident) {
    const now = new Date().toISOString();

    const record = {
      id: incident.id || uuidv4(),
      appId: incident.appId,
      title: incident.title || 'Untitled incident',
      description: incident.description || '',
      severity: incident.severity || 'medium',
      status: incident.status || 'open',
      source: incident.source || 'monitoring',
      detectedAt: incident.detectedAt || now,
      lastFailureAt: incident.lastFailureAt || now,
      createdAt: incident.createdAt || now,
      updatedAt: now,
      healthCheck: incident.healthCheck || {},
      timeline: incident.timeline || [
        _timelineEntry('created', 'Incident created'),
      ],
    };

    incidents.push(record);
    return record;
  }

  /**
   * Update an existing incident in-place.
   * Only the fields present on the supplied object are merged; `updatedAt` is
   * always refreshed.
   *
   * @param {object} incident - must contain at least `id`
   * @returns {object|undefined} the updated record, or undefined if not found
   */
  function update(incident) {
    const idx = incidents.findIndex((inc) => inc.id === incident.id);
    if (idx === -1) return undefined;

    const now = new Date().toISOString();
    const existing = incidents[idx];

    // Merge provided fields onto the existing record.
    Object.assign(existing, incident, { updatedAt: now });

    return existing;
  }

  /**
   * Append a timeline entry to an incident and refresh its `updatedAt`.
   *
   * @param {string} id     - incident id
   * @param {string} event  - short event label
   * @param {string} detail - human-readable description
   * @returns {object|undefined} the updated record, or undefined if not found
   */
  function addTimelineEntry(id, event, detail) {
    const incident = getById(id);
    if (!incident) return undefined;

    incident.timeline.push(_timelineEntry(event, detail));
    incident.updatedAt = new Date().toISOString();

    return incident;
  }

  // ---- expose -------------------------------------------------------------

  return { getAll, getById, getOpenByAppId, create, update, addTimelineEntry };
}

// Default singleton used across the application at runtime.
export const incidentStore = createIncidentStore();
