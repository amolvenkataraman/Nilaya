// Settings › Appearance: the theme, kept per browser (lib/theme) so each device can differ.
import { Segmented, type SegmentOption } from '../../components/ui'
import { setTheme, type ThemePref, useTheme } from '../../lib/theme'
import { cardClass } from './Card'
import { SettingRow, SettingsSection, segmentedReset } from './SettingsSection'

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
          <Segmented label="Theme" value={pref} onChange={setTheme} options={OPTIONS} className={segmentedReset} />
        </SettingRow>
      </div>
    </SettingsSection>
  )
}
