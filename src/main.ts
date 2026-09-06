import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApplication } from './bootstrap/configure-application';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  configureApplication(app);
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Maryme API')
      .setVersion('1')
      .addBearerAuth()
      .addCookieAuth('maryme_refresh')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  await app.listen(config.getOrThrow<number>('app.port'), '0.0.0.0');
}
void bootstrap();
