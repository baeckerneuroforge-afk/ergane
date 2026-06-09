import { OrganizationList } from '@clerk/nextjs';

// Reached when a signed-in user has no active organization. B2B-only:
// `hidePersonal` hides personal accounts so there is always a real tenant.
export default function SelectOrgPage() {
  return (
    <div>
      <h1>Choose an organization</h1>
      <p className="muted">
        ergane is multi-tenant. Pick an organization to enter, or create a new one.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '1rem' }}>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
        />
      </div>
    </div>
  );
}
