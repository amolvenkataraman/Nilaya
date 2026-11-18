// The last Settings sections: staff links (Usage, the Django admin) and "More" (your public profile).
import { userPath } from '../users/UserLink'
import { cardClass, SettingLink, SettingsSection } from '../../components/ui'

export function AdminSection() {
  return (
    <SettingsSection id="set-admin" title="Admin" description="Staff only.">
      <div className={cardClass}>
        <SettingLink icon="chart" label="Usage" note="Page views and API calls per person and app" to="/settings/usage" />
        <SettingLink icon="wrench" label="Admin site" note="Users, groups and all data" href="/admin/" />
      </div>
    </SettingsSection>
  )
}

export function MoreSection({ username }: { username?: string }) {
  return (
    <SettingsSection id="set-links" title="More">
      <div className={cardClass}>
        {username && <SettingLink icon="user" label="Your profile" note="As others see it" to={userPath(username)} />}
      </div>
    </SettingsSection>
  )
}
