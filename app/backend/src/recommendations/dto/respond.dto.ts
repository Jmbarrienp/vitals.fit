import { IsEnum } from 'class-validator';

export enum ResponseAction { ACCEPTED = 'ACCEPTED', REJECTED = 'REJECTED' }

export class RespondDto {
  @IsEnum(ResponseAction)
  action: ResponseAction;
}
