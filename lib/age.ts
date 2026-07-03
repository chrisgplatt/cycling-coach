export function calculateAge(dateOfBirth: string, today: Date = new Date()): number {
  const dob = new Date(dateOfBirth)
  let age = today.getFullYear() - dob.getFullYear()
  const hasHadBirthdayThisYear =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate())
  if (!hasHadBirthdayThisYear) age--
  return age
}
