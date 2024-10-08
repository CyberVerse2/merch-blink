import * as fal from '@fal-ai/serverless-client';
import { NextRequest, NextResponse } from 'next/server';
import { BlinksightsClient } from 'blinksights-sdk';
import {
  ACTIONS_CORS_HEADERS,
  createPostResponse,
  ActionGetResponse,
  MEMO_PROGRAM_ID,
  createActionHeaders
} from '@solana/actions';
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';

fal.config({
  credentials: process.env.FAL_AI_API_KEY
});

const client = new BlinksightsClient(process.env.BLINKSIGHTS_API_KEY!);

const headers = createActionHeaders();

const SEND_TOKEN_ADDRESS = new PublicKey('SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa');
const RECIPIENT_ADDRESS = new PublicKey('6kexz7VwA5J895tdWaDP6b4S9okQez1Att6E2jzWLXMk');

async function makeGetRequest(endpoint: string, queryParams: Record<string, string>) {
  const url = new URL(endpoint);
  Object.entries(queryParams).forEach(([key, value]) => url.searchParams.append(key, value));
  const response = await fetch(url.toString());
  return response.json();
}

export async function GET(req: NextRequest) {
  const queryParams = {
    query: req.url.split('=')[1]
  };
  console.log(queryParams.query);
  const merchDetails = await makeGetRequest(
    'https://fortunate-emotion-production.up.railway.app/api/v1/merch',
    queryParams
  );
  console.log(merchDetails);

  let response = await client.createActionGetResponseV1(req.url, {
    type: 'action',
    icon: `https://res.cloudinary.com/dbuaprzc0/image/upload/f_auto,q_auto/xav9x6oqqsxmn5w9rqhg`,
    title: 'Geneva',
    description: `Generate an Image pased on a prompt 
  10 $SEND to generate a normal image
  20 $SEND to generate an ultra-realistic image`,
    label: 'Generate Image',
    links: {
      actions: [
        {
          label: 'Pay in $SEND',
          href: '/api/actions/glitch-my-pfp',
          parameters: [
            {
              name: 'prompt',
              label: 'Go wild..',
              type: 'textarea'
            },
            {
              name: 'isUltra',
              label: '',
              type: 'checkbox',
              options: [
                {
                  label: 'Ultra-Realistic Mode',
                  value: 'ultra',
                  selected: false
                }
              ]
            }
          ]
        }
      ]
    }
  });

  return NextResponse.json(response, {
    headers: ACTIONS_CORS_HEADERS
  });
}

export const OPTIONS = async () => Response.json(null, { headers });

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      account: string;
      data: { prompt: string; isUltra: Array<string> };
    };

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      throw 'Invalid "account" provided';
    }
    await client.trackActionV2(account as unknown as string, req.url);

    const { searchParams } = new URL(req.url);
    console.log(searchParams);
    const prompt = body?.data?.prompt || searchParams.get('prompt');
    console.log(prompt);

    if (!prompt) {
      throw new Error('Prompt is required');
    }
    let ultraman = body?.data?.isUltra || searchParams.get('isUltra')?.split('');
    let isUltra: boolean = false;

    if (ultraman[0] === 'ultra') {
      isUltra = true;
    }

    const connection = new Connection(process.env.SOLANA_RPC!, 'confirmed');

    // Get the associated token addresses
    const fromTokenAddress = await getAssociatedTokenAddress(SEND_TOKEN_ADDRESS, account);
    const toTokenAddress = await getAssociatedTokenAddress(SEND_TOKEN_ADDRESS, RECIPIENT_ADDRESS);
    console.log(fromTokenAddress, toTokenAddress);

    const transaction = new Transaction();

    // Check if the recipient's token account exists, if not, create it
    const toTokenAccount = await connection.getAccountInfo(toTokenAddress);
    console.log(toTokenAccount);
    if (!toTokenAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          account,
          toTokenAddress,
          RECIPIENT_ADDRESS,
          SEND_TOKEN_ADDRESS
        )
      );
    }

    // Add transfer instruction
    const imageGenerationCost = isUltra ? 20000000 : 10000000; // calculate cost based on isUltra
    transaction.add(
      createTransferInstruction(
        fromTokenAddress,
        toTokenAddress,
        account,
        imageGenerationCost, // 10 SEND tokens (assuming 9 decimals)
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // Set the fee payer
    transaction.feePayer = account;

    // Get the latest blockhash
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Sign the transaction

    const payload = await createPostResponse({
      fields: {
        transaction,
        message: `Image generated successfully`,
        links: {
          next: {
            type: 'post',
            href: `/api/actions/glitch-my-pfp/create-nft?url=${`https://google.com`}`
          }
        }
      }
    });

    return NextResponse.json(payload, {
      headers: ACTIONS_CORS_HEADERS
    });
  } catch (err) {
    console.error('Error in POST /api/glitch-my-pfp', err);
    let message = 'An unknown error occurred';
    if (err instanceof Error) message = err.message;
    return new Response(message, {
      status: 400,
      headers: ACTIONS_CORS_HEADERS
    });
  }
}
