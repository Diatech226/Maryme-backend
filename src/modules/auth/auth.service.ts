import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CoupleStatus, User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';

export interface SafeUser { id:string;email:string;phone:string|null;role:UserRole;coupleId:string|null;firstName:string|null;lastName:string|null }
export interface SessionResult { accessToken:string;refreshToken:string;user:SafeUser }
type UserWithStatus=User&{couple:{status:CoupleStatus;deletedAt:Date|null}|null};
@Injectable()
export class AuthService {
  constructor(private readonly prisma:PrismaService,private readonly jwt:JwtService,private readonly config:ConfigService,private readonly audit:AuditService){}
  private hash(token:string){return createHash('sha256').update(token).digest('hex')}
  private safe(user:User):SafeUser{return{id:user.id,email:user.email,phone:user.phone,role:user.role,coupleId:user.coupleId,firstName:user.firstName,lastName:user.lastName}}
  private assertAccess(user:UserWithStatus){if(!user.isActive)throw new UnauthorizedException('Account is inactive');if(user.role===UserRole.COUPLE&&(!user.couple||user.couple.deletedAt||user.couple.status!==CoupleStatus.AUTHORIZED))throw new ForbiddenException(`Couple access is ${user.couple?.status.toLowerCase()??'unavailable'}`)}
  private async issue(user:User,ipAddress?:string,userAgent?:string):Promise<SessionResult>{const accessToken=await this.jwt.signAsync({sub:user.id,role:user.role,...(user.coupleId?{coupleId:user.coupleId}:{})});const refreshToken=randomBytes(48).toString('base64url');await this.prisma.refreshSession.create({data:{userId:user.id,tokenHash:this.hash(refreshToken),expiresAt:new Date(Date.now()+30*86400000),ipAddress,userAgent}});return{accessToken,refreshToken,user:this.safe(user)}}
  async login(dto:LoginDto,ip?:string,agent?:string){const user=await this.prisma.user.findUnique({where:{email:dto.email.trim().toLowerCase()},include:{couple:{select:{status:true,deletedAt:true}}}});if(!user||!user.isActive||!(await argon2.verify(user.passwordHash,dto.password))){void this.audit.record({action:'LOGIN_FAILED',entityType:'User',metadata:{email:dto.email.trim().toLowerCase()},ipAddress:ip,userAgent:agent});throw new UnauthorizedException('Invalid credentials')}this.assertAccess(user);await this.prisma.user.update({where:{id:user.id},data:{lastLoginAt:new Date()}});void this.audit.record({userId:user.id,action:'LOGIN_SUCCESS',entityType:'User',entityId:user.id,ipAddress:ip,userAgent:agent});return this.issue(user,ip,agent)}
  async refresh(token:string|undefined,ip?:string,agent?:string){if(!token)throw new UnauthorizedException('Refresh token required');const session=await this.prisma.refreshSession.findUnique({where:{tokenHash:this.hash(token)},include:{user:{include:{couple:{select:{status:true,deletedAt:true}}}}}});if(!session||session.revokedAt||session.expiresAt<=new Date()){if(session?.revokedAt)await this.prisma.refreshSession.updateMany({where:{userId:session.userId},data:{revokedAt:new Date()}});throw new UnauthorizedException('Invalid or reused refresh token')}this.assertAccess(session.user);const next=await this.issue(session.user,ip,agent);const replacement=await this.prisma.refreshSession.findUniqueOrThrow({where:{tokenHash:this.hash(next.refreshToken)}});await this.prisma.refreshSession.update({where:{id:session.id},data:{revokedAt:new Date(),replacedById:replacement.id}});return next}
  async logout(token?:string){if(token)await this.prisma.refreshSession.updateMany({where:{tokenHash:this.hash(token),revokedAt:null},data:{revokedAt:new Date()}})}
  async me(id:string){const user=await this.prisma.user.findUnique({where:{id},include:{couple:{select:{status:true,deletedAt:true}}}});if(!user)throw new UnauthorizedException();this.assertAccess(user);return this.safe(user)}
}
