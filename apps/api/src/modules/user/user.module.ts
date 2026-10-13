import { Module } from '@nestjs/common';

import { UserSearchController } from './user-search.controller.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  controllers: [UserController, UserSearchController],
  providers: [UserService],
})
export class UserModule {}
