import type { SemanticProfile } from "../../../core/semantic/SemanticProfile.js";

/**
 * SAMPLE profile: the reference concept set from the requirements (cloud
 * incident reports). It is ordinary configuration, not parser logic - the
 * parser accepts any SemanticProfile.
 *
 * TODO(manual): replace/extend with your real document-specific profiles.
 */
export const incidentReportProfile: SemanticProfile = {
  concepts: [
    {
      key: "INCIDENT",
      description: "An operational event causing degradation, disruption, or outage of a service",
      category: "event",
      aliases: ["incident", "outage", "disruption", "service incident"],
      idPrefix: "incident",
    },
    {
      key: "ROOT_CAUSE",
      description: "The fundamental event, condition, or technical reason responsible for the incident",
      category: "causation",
      aliases: ["root cause", "underlying cause", "technical cause", "cause of incident"],
      idPrefix: "cause",
    },
    {
      key: "AFFECTED_SERVICE",
      description: "A product, application, platform, or service affected by the incident",
      category: "impact",
      aliases: ["affected service", "impacted service", "affected product"],
      idPrefix: "service",
    },
    {
      key: "CUSTOMER_IMPACT",
      description: "The effect of the incident on customers or users",
      category: "impact",
      aliases: ["customer impact", "user impact", "customer effect"],
      idPrefix: "impact",
    },
    {
      key: "AFFECTED_LOCATION",
      description: "A geographic, regional, zonal, or infrastructure location affected by an incident",
      category: "scope",
      aliases: ["affected region", "affected zone", "location", "impacted location"],
      idPrefix: "location",
    },
    {
      key: "REMEDIATION",
      description: "An action taken to mitigate, resolve, or recover from an incident",
      category: "resolution",
      aliases: ["mitigation", "remediation", "recovery action", "corrective action"],
      idPrefix: "remediation",
    },
    {
      key: "TIMELINE_EVENT",
      description: "A dated or ordered event describing the progression of an incident",
      category: "timeline",
      aliases: ["timeline", "incident update", "status update", "event"],
      idPrefix: "timeline",
    },
  ],
  relationships: [
    { key: "CAUSES", description: "One event or condition causes another" },
    { key: "AFFECTS", description: "An incident or condition affects a service or resource" },
    { key: "OCCURS_IN", description: "An incident or event occurs within a location or environment" },
    { key: "MITIGATED_BY", description: "An incident is mitigated by an action or intervention" },
    { key: "DEPENDS_ON", description: "One component depends on another component or service" },
  ],
};
