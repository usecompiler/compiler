# Setting Up a GitHub App for Self-Hosting

This guide walks you through creating a private GitHub App to connect your self-hosted instance with your GitHub repositories.

## Prerequisites

- A GitHub account with permission to create GitHub Apps (personal account or organization admin)
- The base URL of your instance (e.g., `https://compiler.yourdomain.com`)

## Step 1: Create a New GitHub App

1. Go to **GitHub Settings**:
   - For personal account: https://github.com/settings/apps/new
   - For organization: https://github.com/organizations/YOUR_ORG/settings/apps/new

2. Fill in the **basic information**:

   | Field               | Value                                                       |
   | ------------------- | ----------------------------------------------------------- |
   | **GitHub App name** | Choose a unique name (e.g., `YourCompany Compiler`)         |
   | **Homepage URL**    | Your instance URL (e.g., `https://compiler.yourdomain.com`) |

3. Configure **Callback URL**:

   ```
   https://compiler.yourdomain.com/onboarding/github-callback
   ```

4. **Uncheck** "Expire user authorization tokens" (not needed)

5. **Uncheck** "Request user authorization (OAuth) during installation" (not needed)

6. Leave **Webhook** section:
   - **Active**: Unchecked (webhooks not required)
   - No webhook URL needed

## Step 2: Configure Permissions

Under **Repository permissions**, set:

| Permission   | Access Level | Purpose                         |
| ------------ | ------------ | ------------------------------- |
| **Contents** | Read-only    | Clone and read repository files |
| **Metadata** | Read-only    | Access repository information   |

Leave all other permissions as "No access".

## Step 3: Installation Settings

Under **Where can this GitHub App be installed?**:

- Select **Only on this account** for private use

## Step 4: Create the App

Click **Create GitHub App**.

You'll be redirected to your new app's settings page.

## Step 5: Note Your App Credentials

After creation, collect these values:

### App ID

Found at the top of the app settings page:

```
App ID: 123456
```

### App Slug

Found in the URL of your app's public page:

```
https://github.com/apps/your-app-slug
                       ^^^^^^^^^^^^^^
```

### Private Key

1. Scroll down to **Private keys** section
2. Click **Generate a private key**
3. A `.pem` file will download automatically
4. **Keep this file secure** - it's used to authenticate your app

The private key looks like:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...many lines of base64...
-----END RSA PRIVATE KEY-----
```

## Step 6: Configure Your Self-Hosted Instance

1. Log in to your self-hosted instance as an admin

2. Navigate to **Settings** > **GitHub** (or `/settings/github`)

3. Enter your credentials:

   | Field           | Value                                        |
   | --------------- | -------------------------------------------- |
   | **App ID**      | The numeric App ID from Step 5               |
   | **App Slug**    | The slug from your app's URL                 |
   | **Private Key** | Paste the entire contents of the `.pem` file |

4. Click **Save Configuration**

   The app will validate your private key by attempting to generate a JWT.

## Step 7: Install the App on Your Repositories

1. After saving the configuration, click **Install GitHub App**

2. You'll be redirected to GitHub to authorize the installation

3. Select which repositories to grant access to:
   - **All repositories** - Access to all current and future repos
   - **Only select repositories** - Choose specific repos (recommended)

4. Click **Install**

5. You'll be redirected back to your instance with the installation complete

## Step 8: Add Repositories

1. Go to **Settings** > **Repositories** (or `/settings/repositories`)

2. You'll see a list of repositories the app has access to

3. Click **Add** next to repositories you want to analyze

4. The app will clone the repository in the background

## App Permissions Summary

| Permission | Level | Required | Purpose                 |
| ---------- | ----- | -------- | ----------------------- |
| Contents   | Read  | Yes      | Clone repos, read files |
| Metadata   | Read  | Yes      | List repos, get info    |
| All others | None  | No       | Not used                |
