"use client";

import { useState } from "react";

const inputStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--m-hairline)",
  background: "var(--m-surface)",
  fontSize: 15,
  color: "var(--m-foreground)",
  fontFamily: "inherit",
} as const;

export function PilotForm() {
  const [values, setValues] = useState({ name: "", company: "", email: "", useCase: "" });
  const [sent, setSent] = useState(false);

  function update(field: keyof typeof values) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    console.log("Pilot request submitted:", values);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="m-card" style={{ textAlign: "center", padding: 48 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: "var(--m-foreground)", fontFamily: '"Fraunces", Georgia, serif' }}>
          Thank you.
        </div>
        <p style={{ marginTop: 12, color: "var(--m-body)" }}>
          We'll be in touch within 48 hours.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="name" style={{ fontSize: 13, fontWeight: 500, color: "var(--m-foreground)" }}>
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={values.name}
          onChange={update("name")}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="company" style={{ fontSize: 13, fontWeight: 500, color: "var(--m-foreground)" }}>
          Company
        </label>
        <input
          id="company"
          name="company"
          type="text"
          required
          value={values.company}
          onChange={update("company")}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="email" style={{ fontSize: 13, fontWeight: 500, color: "var(--m-foreground)" }}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={values.email}
          onChange={update("email")}
          style={inputStyle}
        />
        <span style={{ fontSize: 12, color: "var(--m-muted-foreground)" }}>
          Work email preferred
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="useCase" style={{ fontSize: 13, fontWeight: 500, color: "var(--m-foreground)" }}>
          Tell us about your use case
        </label>
        <textarea
          id="useCase"
          name="useCase"
          rows={4}
          value={values.useCase}
          onChange={update("useCase")}
          style={{
            ...inputStyle,
            resize: "vertical",
          }}
        />
      </div>

      <button type="submit" className="m-btn-primary" style={{ alignSelf: "flex-start" }}>
        Send request
      </button>
    </form>
  );
}
