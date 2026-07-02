import { OrganizationList } from '@clerk/nextjs';

// Reached when a signed-in user has no active organization. B2B-only:
// `hidePersonal` hides personal accounts so there is always a real tenant.
export default function SelectOrgPage() {
  return (
    <div className="auth-page">
      <div>
        <h1>Organisation wählen</h1>
        <p className="muted">
          ergane ist mandantenfähig. Wähle eine Organisation oder lege eine neue an.
        </p>
      </div>
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/dashboard"
        afterCreateOrganizationUrl="/dashboard"
      />
    </div>
  );
}
