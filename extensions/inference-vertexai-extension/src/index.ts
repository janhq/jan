/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-vertexai-extension/src/index
 */

import { PayloadType, RemoteOAIEngine, SettingComponentProps } from '@janhq/core'
import { SignJWT, importPKCS8 } from 'jose';


export enum Settings {
  location = 'location',
  projectId = 'projectId',
  privateKey = 'privateKey',
  serviceEmail = 'serviceEmail',
  privateKeyId = 'vertexai-api-key'
}
type VertexAIPayloadType = PayloadType &
{
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  max_tokens?: number;
  stop?: string[];
  frequency_penalty?: number;
  presence_penalty?: number;
}
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceVertexAIExtension extends RemoteOAIEngine {
  inferenceUrl: string = ''
  location: string = 'us-central1'
  projectId: string = ''
  provider: string = 'vertexai'
  privateKey: string = ''
  serviceEmail: string = ''
  privateKeyId: string = ''
  expires: number = 0


  override async onLoad(): Promise<void> {
    super.onLoad()

    // Register Settings
    this.registerSettings(SETTINGS)
    this.registerModels(MODELS)

    this.location = await this.getSetting<string>(Settings.location, 'us-central1')
    this.projectId = await this.getSetting<string>(
      Settings.projectId,
      ''
    )
    this.privateKey = await this.getSetting<string>(Settings.privateKey, '')
    this.serviceEmail = await this.getSetting<string>(
      Settings.serviceEmail,
      ''
    )
    this.privateKeyId = await this.getSetting<string>(
      Settings.privateKeyId,
      ''
    )
    await this.updateApiKey()

    this.inferenceUrl = `https://${this.location}-aiplatform.googleapis.com/v1beta1/projects/${this.projectId}/locations/${this.location}/endpoints/openapi/chat/completions`

  }

  async getAccessToken(): Promise<string | null> {
    const authUrl = "https://www.googleapis.com/oauth2/v4/token";

    const issued = Math.floor(Date.now() / 1000);
    const expires = issued + 3600;
    this.expires = expires - 1200 // Remove some time for buffer
    // JWT Headers
    const additionalHeaders = {
      kid: this.privateKeyId,
      alg: "RS256",
      typ: "JWT",
    };

    // JWT Payload
    const payload = {
      iss: this.serviceEmail, // Issuer claim
      sub: this.serviceEmail, // Subject claim
      aud: authUrl, // Audience claim
      iat: issued, // Issued At claim (in seconds since epoch)
      exp: expires, // Expiration time (in seconds since epoch)
      scope: "https://www.googleapis.com/auth/cloud-platform",
    };
    this.privateKey = this.privateKey.replace(/\\n/g, ' ')
    const key = await importPKCS8(this.privateKey, "RS256")
    // Create the signed JWT
    const signedJwt = await new SignJWT(payload)
      .setProtectedHeader(additionalHeaders)
      .setIssuedAt(issued)
      .setExpirationTime(expires)
      .sign(key);

    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.append('assertion', signedJwt);

    try {
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        console.error('Failed to get access token:', await response.text());
        return null;
      }

      const data = await response.json();
      return data.access_token;
    } catch (error) {
      console.error('Error fetching access token:', error);
      return null;
    }

  }


  async updateApiKey(force: boolean = false): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    if (
      this.privateKey !== '' &&
      this.serviceEmail !== '' &&
      this.privateKeyId !== '' &&
      (now > this.expires || force)
    ) {
      const apiKey = await this.getAccessToken();
      if (apiKey) {
        this.apiKey = apiKey;
      } else {
        console.error("Failed to update API key");
      }
    }
  }

  override async updateSettings(componentProps: Partial<SettingComponentProps>[]): Promise<void> {
    await super.updateSettings(componentProps)
    this.updateApiKey(true).catch((error) =>
      console.error("Error updating API key:", error)
    );

  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.location) {
      this.location = value as string
    } else if (key === Settings.projectId) {
      this.projectId = value as string
    } else if (key == Settings.privateKey) {
      this.privateKey = value as string
      this.privateKey = this.privateKey.replace(/\\n/g, ' ') ///\\n/g, '\n'
    } else if (key == Settings.privateKeyId) {
      this.privateKeyId = value as string
    } else if (key == Settings.serviceEmail) {
      this.serviceEmail = value as string
    }
    this.inferenceUrl = `https://${this.location}-aiplatform.googleapis.com/v1beta1/projects/${this.projectId}/locations/${this.location}/endpoints/openapi/chat/completions`

  }


  /**
   * Tranform the payload before sending it to the inference endpoint.
   * @param payload
   * @returns
   */
  transformPayload = (payload: VertexAIPayloadType): VertexAIPayloadType => {
    // Check if the api key needs to be updated and update if so.
    this.updateApiKey().catch((error) =>
      console.error("Error updating API key:", error)
    );
    // Remove empty stop words
    if (payload.stop?.length === 0) {
      const { stop, ...params } = payload
      payload = params
    }
    return payload
  }
}
