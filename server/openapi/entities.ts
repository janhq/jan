export type DeleteObjectResponse =
| {
  message: string;
  id?: undefined;
  object?: undefined;
  deleted?: undefined;
}
| {
  id: string;
  object: string;
  deleted: boolean;
  message?: undefined;
}
| undefined;
