export class UserRegisteredClaims {
  iss: string //Issuer
  sub: string //Subject
  aud?: string //Audience
  exp: number //ExpiresAt (unix timestamp)
  nbf?: number //NotBefore (unix timestamp)
  iat?: number //IssuedAt (unix timestamp)
  id?: string //ID

  full_name: string //FullName
  picture: string //Picture
  email: string //Email
  role: string //Role
  // yourphr#919 (ngdpbase#1805's claim): a test account holds test or sandbox data, never real data.
  test_account?: boolean
}
