// Settings › Appearance: the theme, kept per browser (lib/theme) so each device can differ.
import { cardClass, Segmented, type SegmentOption, SettingRow, SettingsSection } from '../../components/ui'
import { setTheme, type ThemePref, useTheme } from '../../lib/theme'

const OPTIONS: SegmentOption<ThemePref>[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

export function AppearanceSection() {
  const { pref } = useTheme()
  return (
    <SettingsSection
      id="set-appearance"
      title="Appearance"
      description="Saved in this browser only, so each device can have its own theme."
    >
      <div className={cardClass}>
        <SettingRow label="Theme" inline>
          <Segmented label="Theme" value={pref} onChange={setTheme} options={OPTIONS} />
        </SettingRow>
      </div>
    </SettingsSection>
  )
}
