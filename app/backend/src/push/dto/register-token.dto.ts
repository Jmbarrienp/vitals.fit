import { IsIn, IsString, Matches } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  @Matches(/^ExponentPushToken\[.+\]$/, {
    message: 'token must be a valid Expo push token',
  })
  token: string;

  @IsIn(['ios', 'android'])
  platform: string;
}
