# Setting Up AWS Bedrock

This guide walks you through creating AWS credentials to use Claude via Amazon Bedrock instead of the direct Anthropic API.

## Why Use Bedrock?

- Use existing AWS billing and cost management
- Keep traffic within your AWS VPC
- Comply with enterprise AWS-only policies
- Leverage AWS IAM for access control

## Prerequisites

- An AWS account with Bedrock access
- IAM permissions to create users and policies
- Claude models enabled in your Bedrock region

## Step 1: Verify Claude Model Access

Claude models on Bedrock are automatically enabled when first invoked. However, **first-time Anthropic users may need to submit use case details** before access is granted.

1. Open the [Amazon Bedrock console](https://console.aws.amazon.com/bedrock)

2. Select your preferred region (e.g., `us-east-1`, `us-west-2`)

3. Go to **Model catalog** in the left sidebar

4. Search for "Claude" and select a model (e.g., Claude Sonnet 4)

5. Click **Open in playground** to test access

6. If prompted, submit the required use case details for Anthropic models (see below)

Once you've successfully invoked a model, it's enabled account-wide for all users.

### Anthropic Use Case Submission

First-time users will see a form requesting use case details. Here's guidance on what to enter:

| Field                   | What to Enter                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Company name**        | Your company or organization name                                                      |
| **Company website URL** | Your company website                                                                   |
| **Industry**            | Select the closest match (e.g., Technology, Software, Professional Services)           |
| **Intended users**      | Select who will use the application (e.g., "Internal employees", "Business customers") |

**Use case description example:**

> Internal tool for analyzing and understanding how codebases work. Used by our team to explore software projects and get answers to questions about functionality.

**Important:** Do not mention "Claude" in your description - AWS will automatically deny access if detected as it's flagged as Personally Identifiable Information.

## Step 2: Create an IAM Policy

1. Go to [IAM Console](https://console.aws.amazon.com/iam) > **Policies** > **Create policy**

2. Select **JSON** tab and paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "BedrockModelAccess",
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:InvokeModelWithResponseStream"
         ],
         "Resource": [
           "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
           "arn:aws:bedrock:*:*:inference-profile/*"
         ]
       },
       {
         "Sid": "BedrockListAccess",
         "Effect": "Allow",
         "Action": [
           "bedrock:ListFoundationModels",
           "bedrock:ListInferenceProfiles"
         ],
         "Resource": "*"
       },
       {
         "Sid": "MarketplaceAccess",
         "Effect": "Allow",
         "Action": [
           "aws-marketplace:ViewSubscriptions",
           "aws-marketplace:Subscribe"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

3. Click **Next**

4. Name the policy (e.g., `CompilerBedrockAccess`)

5. Click **Create policy**

## Step 3: Create an IAM User

1. Go to **IAM** > **Users** > **Create user**

2. Enter a username (e.g., `compiler-bedrock`)

3. Click **Next**

4. Select **Attach policies directly**

5. Search for and select your policy (`CompilerBedrockAccess`)

6. Click **Next** > **Create user**

## Step 4: Create Access Keys

1. Click on the user you just created

2. Go to **Security credentials** tab

3. Under **Access keys**, click **Create access key**

4. Select **Application running outside AWS**

5. Click **Next** > **Create access key**

6. **Save these credentials securely**:
   - Access key ID: `AKIA...`
   - Secret access key: `wJalrXUtnFEMI...`

   **Warning:** The secret access key is only shown once. Download the CSV or copy it now.

## Step 5: Configure Your Instance

1. Log in to your self-hosted instance as an admin

2. Navigate to **Settings** > **AI Provider** (or `/settings/ai-provider`)

3. Select **AWS Bedrock** as the provider

4. Enter your credentials:

   | Field                 | Value                                                   |
   | --------------------- | ------------------------------------------------------- |
   | **AWS Region**        | The region where you enabled models (e.g., `us-east-1`) |
   | **Access Key ID**     | Your IAM user access key                                |
   | **Secret Access Key** | Your IAM user secret key                                |

5. Click **Save Configuration**

   The app will validate your credentials by calling the Bedrock API.

## Troubleshooting

### "Unsupported model or your request did not allow prompt caching"

This error occurs when prompt caching is not available in your AWS region. The application automatically disables prompt caching for Bedrock connections to avoid this issue.

If you're still seeing this error after updating, ensure you're running the latest version of the application.

### Organization SCP Blocking Cross-Region Access

If your AWS Organization has Service Control Policies (SCPs) that restrict Bedrock to specific regions:

1. Use a region where your organization allows Bedrock access (check with your AWS administrator)
2. Use direct foundation model IDs (e.g., `anthropic.claude-3-5-sonnet-20241022-v2:0`) rather than inference profiles
3. Cross-region inference profiles (`apac.*`, `global.*`, `us.*`) will not work if SCPs block those regions

### Access Denied Errors

1. Verify your IAM policy includes all required permissions (see Step 2)
2. Ensure Claude models are enabled in your selected region (see Step 1)
3. Check if your organization has SCPs limiting Bedrock access
