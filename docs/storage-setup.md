# Setting Up Storage (Amazon S3)

This guide walks you through configuring Amazon S3 storage for your instance, enabling file uploads (images, documents) within conversations.

## Prerequisites

- An AWS account
- An S3 bucket (or permissions to create one)
- IAM permissions to create users and policies

## Step 1: Create an S3 Bucket

1. Open the [Amazon S3 console](https://console.aws.amazon.com/s3)

2. Click **Create bucket**

3. Configure the bucket:

   | Setting                           | Recommended Value                                |
   | --------------------------------- | ------------------------------------------------ |
   | **Bucket name**                   | A unique name (e.g., `yourcompany-compiler-files`) |
   | **AWS Region**                    | Choose the region closest to your instance       |
   | **Block all public access**       | Enabled (keep the default)                       |
   | **Bucket Versioning**             | Disabled (optional)                              |
   | **Default encryption**            | SSE-S3 (default)                                 |

4. Click **Create bucket**

## Step 2: Create an IAM Policy

1. Go to [IAM Console](https://console.aws.amazon.com/iam) > **Policies** > **Create policy**

2. Select the **JSON** tab and paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "CompilerStorageAccess",
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject"
         ],
         "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
       }
     ]
   }
   ```

   Replace `YOUR_BUCKET_NAME` with your actual bucket name.

3. Click **Next**

4. Name the policy (e.g., `CompilerStorageAccess`)

5. Click **Create policy**

## Step 3: Create an IAM User

1. Go to **IAM** > **Users** > **Create user**

2. Enter a username (e.g., `compiler-storage`)

3. Click **Next**

4. Select **Attach policies directly**

5. Search for and select your policy (`CompilerStorageAccess`)

6. Click **Next** > **Create user**

## Step 4: Create Access Keys

1. Click on the user you just created

2. Go to the **Security credentials** tab

3. Under **Access keys**, click **Create access key**

4. Select **Application running outside AWS**

5. Click **Next** > **Create access key**

6. **Save these credentials securely**:
   - Access key ID: `AKIA...`
   - Secret access key: `wJalrXUtnFEMI...`

   **Warning:** The secret access key is only shown once. Download the CSV or copy it now.

## Step 5: Configure in the App

1. Log in to your instance as an admin

2. Navigate to **Settings** > **Storage** (or `/settings/storage`)

3. Enter your configuration:

   | Field                 | Value                                                  |
   | --------------------- | ------------------------------------------------------ |
   | **Bucket Name**       | Your S3 bucket name (e.g., `yourcompany-compiler-files`) |
   | **Region**            | The AWS region of your bucket (e.g., `us-east-1`)      |
   | **Access Key ID**     | Your IAM user access key                               |
   | **Secret Access Key** | Your IAM user secret key                               |

4. Click **Save Configuration**

## Verification

1. Open any conversation

2. Upload a file (image or document) using the file attachment button

3. Confirm the file appears in the conversation

If the upload succeeds, your storage is configured correctly.

## Removing Configuration

1. Navigate to **Settings** > **Storage**

2. Click **Remove**

3. Confirm the removal when prompted

**Warning:** After removing the storage configuration, previously uploaded files will no longer be accessible.

## Troubleshooting

### Access Denied (403)

1. Verify your IAM policy includes both `s3:PutObject` and `s3:GetObject` permissions
2. Confirm the policy `Resource` matches your bucket name exactly (`arn:aws:s3:::YOUR_BUCKET/*`)
3. Check that the access key ID and secret access key are correct

### Invalid Bucket Name

1. Ensure the bucket name matches exactly (no leading/trailing spaces)
2. Confirm the bucket exists in the specified region

### Wrong Region

1. The region must match where your bucket was created (e.g., `us-east-1`, `eu-west-1`)
2. Check your bucket's region in the S3 console under **Properties**

### Upload Fails with Network Error

1. Verify your instance can reach `your-bucket.s3.your-region.amazonaws.com`
2. Check that no firewall or proxy is blocking outbound HTTPS traffic to AWS
