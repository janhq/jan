type PrimaryColor =
  | 'primary-blue'
  | 'primary-green'
  | 'primary-purple'
  | 'primary-yellow'

type UserConfig = {
  gettingStartedShow?: boolean
  primaryColor?: PrimaryColor
}
