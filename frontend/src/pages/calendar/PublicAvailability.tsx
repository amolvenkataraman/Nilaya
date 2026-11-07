// Someone's busy times for signed-out visitors (/calendar/availability/:username): the same view as
// in the app, inside the public pages' frame. Signed in, the route lives inside Calendar instead.
import { useParams } from 'react-router'
import { PublicFrame, usePublicTitle } from '../public/PublicFrame'
import AvailabilityPage from './Availability'

export default function PublicAvailability() {
  const { username = '' } = useParams()
  usePublicTitle(`@${username}: availability`)
  return (
    <PublicFrame wide>
      <AvailabilityPage bare />
    </PublicFrame>
  )
}
