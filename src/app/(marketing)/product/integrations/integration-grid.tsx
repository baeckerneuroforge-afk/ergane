"use client";

import { BrandLogo } from "@/components/marketing/logo";

const CATEGORIES: {
  label: string;
  items: { slug: string; name: string; tint: string }[];
}[] = [
  {
    label: "Communication",
    items: [
      { slug: "slack", name: "Slack", tint: "#ECB22E" },
      { slug: "zoom", name: "Zoom", tint: "#2D8CFF" },
      { slug: "microsoft-teams", name: "Teams", tint: "#6264A7" },
      { slug: "gmail", name: "Gmail", tint: "#EA4335" },
      { slug: "microsoft-outlook", name: "Outlook", tint: "#0078D4" },
    ],
  },
  {
    label: "Productivity",
    items: [
      { slug: "notion", name: "Notion", tint: "#000000" },
      { slug: "google-drive", name: "Drive", tint: "#4285F4" },
      { slug: "google-calendar", name: "Calendar", tint: "#4285F4" },
    ],
  },
  {
    label: "Development",
    items: [
      { slug: "linear", name: "Linear", tint: "#5E6AD2" },
      { slug: "github", name: "GitHub", tint: "#181717" },
    ],
  },
  {
    label: "CRM",
    items: [
      { slug: "hubspot", name: "HubSpot", tint: "#FF7A59" },
      { slug: "salesforce", name: "Salesforce", tint: "#00A1E0" },
    ],
  },
  {
    label: "ERP",
    items: [{ slug: "sap", name: "SAP", tint: "#0FAAFF" }],
  },
  {
    label: "Custom",
    items: [
      { slug: "webhooks", name: "Webhooks", tint: "#85878F" },
      { slug: "api", name: "API", tint: "#85878F" },
    ],
  },
];

export function IntegrationGrid() {
  return (
    <div style={{ marginTop: 48, display: "grid", gap: 40 }}>
      {CATEGORIES.map((cat) => (
        <div key={cat.label}>
          <div
            className="m-mono-sm"
            style={{
              color: "var(--m-muted-foreground)",
              marginBottom: 16,
            }}
          >
            {cat.label.toLowerCase()}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {cat.items.map((item) => (
              <div
                key={item.slug}
                className="m-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "16px 20px",
                }}
              >
                <BrandLogo
                  slug={item.slug}
                  name={item.name}
                  size={28}
                  tint={item.tint}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--m-foreground)",
                  }}
                >
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
