const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const POWENS_CLIENT_ID = process.env.POWENS_CLIENT_ID;
const POWENS_CLIENT_SECRET = process.env.POWENS_CLIENT_SECRET;
const POWENS_API_URL = process.env.POWENS_API_URL;
const POWENS_AUTH_URL = process.env.POWENS_AUTH_URL;
const POWENS_REDIRECT_URI = process.env.POWENS_REDIRECT_URI;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Create Basic Auth header
const getBasicAuth = () => {
  const credentials = `${POWENS_CLIENT_ID}:${POWENS_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
};

// Powens API client
const powensClient = axios.create({
  baseURL: POWENS_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': getBasicAuth(),
  },
});

/**
 * GET /powens/callback
 * OAuth callback - redirects to app with code
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    console.log('OAuth callback received:', { code: code.substring(0, 10) + '...', state: state.substring(0, 10) + '...' });

    // Redirect to app with deep link
    const deepLink = `finaice://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    
    // Send HTML that redirects via JavaScript (works better on mobile)
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Connexion réussie</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .container {
              text-align: center;
              padding: 2rem;
            }
            h1 { font-size: 2rem; margin-bottom: 1rem; }
            p { font-size: 1.2rem; opacity: 0.9; }
            .spinner {
              border: 3px solid rgba(255,255,255,0.3);
              border-top: 3px solid white;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 2rem auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Connexion bancaire réussie!</h1>
            <div class="spinner"></div>
            <p>Retour à l'application...</p>
          </div>
          <script>
            // Redirect to app
            setTimeout(() => {
              window.location.href = '${deepLink}';
            }, 500);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in callback:', error);
    res.status(500).send('Error processing callback');
  }
});

/**
 * GET /powens/auth
 * Generate OAuth URL for frontend
 */
router.get('/auth', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state in Supabase
    await supabase
      .from('oauth_states')
      .insert({
        state,
        user_id: userId,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
      });

    // Generate OAuth URL - Standard OAuth flow, no user creation needed
    const authUrl = new URL(`${POWENS_AUTH_URL}/auth/webview/fr/connect`);
    authUrl.searchParams.append('client_id', POWENS_CLIENT_ID);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('redirect_uri', POWENS_REDIRECT_URI);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('scope', 'transactions accounts');

    console.log('OAuth URL generated:', authUrl.toString());

    res.json({
      authUrl: authUrl.toString(),
      state,
    });
  } catch (error) {
    console.error('Error generating auth URL:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to generate auth URL',
      details: error.response?.data || error.message 
    });
  }
});

/**
 * POST /powens/exchange
 * Exchange authorization code for access token
 */
router.post('/exchange', async (req, res) => {
  try {
    const { code, state, userId } = req.body;

    if (!code || !state || !userId) {
      return res.status(400).json({ error: 'code, state, and userId are required' });
    }

    // Verify state (CSRF protection)
    const { data: stateData, error: stateError } = await supabase
      .from('oauth_states')
      .select('*')
      .eq('state', state)
      .eq('user_id', userId)
      .single();

    if (stateError || !stateData) {
      return res.status(400).json({ error: 'Invalid state' });
    }

    // Check if state is expired
    if (new Date(stateData.expires_at) < new Date()) {
      return res.status(400).json({ error: 'State expired' });
    }

    // Exchange code for token
    const tokenResponse = await axios.post(
      `${POWENS_AUTH_URL}/auth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: POWENS_REDIRECT_URI,
        client_id: POWENS_CLIENT_ID,
        client_secret: POWENS_CLIENT_SECRET,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Store tokens in Supabase
    await supabase
      .from('powens_tokens')
      .upsert({
        user_id: userId,
        powens_user_id: stateData.powens_user_id,
        access_token,
        refresh_token,
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });

    // Delete used state
    await supabase.from('oauth_states').delete().eq('state', state);

    // Fetch initial data
    await syncUserData(userId, access_token);

    res.json({
      success: true,
      message: 'Bank connection successful',
    });
  } catch (error) {
    console.error('Error exchanging code:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to exchange code',
      details: error.response?.data || error.message 
    });
  }
});

/**
 * GET /powens/accounts/:userId
 * Get user's bank accounts
 */
router.get('/accounts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const accessToken = await getValidAccessToken(userId);

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid access token' });
    }

    const response = await powensClient.get('/users/me/accounts', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching accounts:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to fetch accounts',
      details: error.response?.data || error.message 
    });
  }
});

/**
 * GET /powens/transactions/:userId
 * Get user's transactions
 */
router.get('/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { accountId, from, to, limit = 100 } = req.query;
    
    const accessToken = await getValidAccessToken(userId);

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid access token' });
    }

    const endpoint = accountId 
      ? `/users/me/accounts/${accountId}/transactions`
      : '/users/me/transactions';

    const response = await powensClient.get(endpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      params: { from, to, limit },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching transactions:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to fetch transactions',
      details: error.response?.data || error.message 
    });
  }
});

/**
 * POST /powens/webhook
 * Handle Powens webhooks
 */
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    
    console.log('Received Powens webhook:', event);

    // Verify webhook signature here if Powens provides one
    
    // Handle different event types
    switch (event.type) {
      case 'account.created':
      case 'account.updated':
        await handleAccountUpdate(event);
        break;
      case 'transaction.created':
      case 'transaction.updated':
        await handleTransactionUpdate(event);
        break;
      case 'connection.synced':
        await handleConnectionSync(event);
        break;
      default:
        console.log('Unknown webhook event type:', event.type);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * POST /powens/sync/:userId
 * Manually trigger data sync
 */
router.post('/sync/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const accessToken = await getValidAccessToken(userId);

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid access token' });
    }

    await syncUserData(userId, accessToken);

    res.json({ success: true, message: 'Data synced successfully' });
  } catch (error) {
    console.error('Error syncing data:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Helper functions

async function getOrCreatePowensUser(userId) {
  // Check if user already has a Powens user
  const { data: existingToken } = await supabase
    .from('powens_tokens')
    .select('powens_user_id')
    .eq('user_id', userId)
    .single();

  if (existingToken?.powens_user_id) {
    return { id: existingToken.powens_user_id };
  }

  // Create new Powens user
  const response = await powensClient.post('/users', {});
  return { id: response.data.id_user };
}

async function getValidAccessToken(userId) {
  const { data: tokenData } = await supabase
    .from('powens_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!tokenData) {
    return null;
  }

  // Check if token is expired
  if (new Date(tokenData.expires_at) < new Date()) {
    // Refresh token
    try {
      const response = await axios.post(
        `${POWENS_AUTH_URL}/auth/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          client_id: POWENS_CLIENT_ID,
          client_secret: POWENS_CLIENT_SECRET,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      await supabase
        .from('powens_tokens')
        .update({
          access_token,
          refresh_token,
          expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        })
        .eq('user_id', userId);

      return access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    }
  }

  return tokenData.access_token;
}

async function syncUserData(userId, accessToken) {
  try {
    // Fetch accounts
    const accountsResponse = await powensClient.get('/users/me/accounts', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const accounts = accountsResponse.data.accounts || [];

    // Save accounts to Supabase
    for (const account of accounts) {
      await supabase.from('bank_accounts').upsert({
        user_id: userId,
        powens_account_id: account.id,
        name: account.name || account.label,
        bank_name: account.bank_name,
        balance: account.balance || 0,
        type: account.type || 'checking',
        currency: account.currency?.code || 'EUR',
        is_active: true,
        updated_at: new Date().toISOString(),
      });

      // Fetch transactions for this account
      const transactionsResponse = await powensClient.get(
        `/users/me/accounts/${account.id}/transactions`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          params: { limit: 100 },
        }
      );

      const transactions = transactionsResponse.data.transactions || [];

      // Save transactions
      for (const transaction of transactions) {
        await supabase.from('transactions').upsert({
          user_id: userId,
          account_id: null, // You'll need to link this properly
          powens_transaction_id: transaction.id,
          description: transaction.wording || transaction.original_wording,
          amount: transaction.value,
          date: transaction.date,
          category: transaction.category?.name,
          type: transaction.type,
          merchant: transaction.simplified_wording,
          updated_at: new Date().toISOString(),
        });
      }
    }

    console.log(`Synced ${accounts.length} accounts and transactions for user ${userId}`);
  } catch (error) {
    console.error('Error syncing user data:', error);
    throw error;
  }
}

async function handleAccountUpdate(event) {
  // Handle account webhook event
  console.log('Handling account update:', event);
}

async function handleTransactionUpdate(event) {
  // Handle transaction webhook event
  console.log('Handling transaction update:', event);
}

async function handleConnectionSync(event) {
  // Handle connection sync event
  console.log('Handling connection sync:', event);
}

module.exports = router;
