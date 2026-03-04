# Cloudflare DNS Infrastructure

This directory contains Terraform configuration for managing Cloudflare DNS records for `togather.nyc`.

## Prerequisites

1. **Terraform** >= 1.5.0
   ```bash
   brew install terraform
   ```

2. **Cloudflare API Token** with permissions:
   - `Zone:DNS:Edit` - to manage DNS records
   - `Zone:Zone:Read` - to look up zone information

   Create a token at: https://dash.cloudflare.com/profile/api-tokens

## Local Usage

1. **Initialize Terraform:**
   ```bash
   terraform init
   ```

2. **Preview changes:**
   ```bash
   terraform plan -var="cloudflare_api_token=$CLOUDFLARE_API_TOKEN"
   ```

3. **Apply changes:**
   ```bash
   terraform apply -var="cloudflare_api_token=$CLOUDFLARE_API_TOKEN"
   ```

## CI/CD

Changes to this directory trigger a GitHub Actions workflow that:
- On PR: Runs `terraform plan` and posts the output as a comment
- On merge to `main`: Runs `terraform apply` to update DNS records

### Required Secrets

The GitHub Actions workflow requires the following secrets:
- `TF_API_TOKEN` - Terraform Cloud API token for remote state management
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token for DNS management

To create a Terraform Cloud API token:
1. Go to https://app.terraform.io/app/settings/tokens
2. Create a new team or user token
3. Add it as `TF_API_TOKEN` in GitHub repository secrets

## Adding a New DNS Record

1. Edit `dns.tf` and add a new resource block:
   ```hcl
   resource "cloudflare_record" "my_new_record" {
     zone_id = local.zone_id
     name    = "subdomain"       # e.g., "blog" for blog.togather.nyc
     type    = "CNAME"           # A, AAAA, CNAME, TXT, MX, etc.
     content = "target.example.com"
     proxied = true              # true for Cloudflare proxy, false for DNS-only
     comment = "Description of this record"
   }
   ```

2. Run `terraform plan` to preview the change

3. Create a PR for review

4. On merge, the record will be created automatically

## Importing Existing Records

If a record already exists in Cloudflare and you want to manage it with Terraform:

1. Add the resource block to `dns.tf`

2. Import it:
   ```bash
   terraform import cloudflare_record.my_record <zone_id>/<record_id>
   ```

   Find the record ID in the Cloudflare dashboard or via API.

## File Structure

```
infrastructure/cloudflare/
├── main.tf          # Provider configuration
├── variables.tf     # Input variables
├── dns.tf           # DNS record definitions
├── outputs.tf       # Output values
├── .gitignore       # Ignore state files
└── README.md        # This file
```

## Troubleshooting

### "Authentication error"
Your API token doesn't have the required permissions. Create a new token with `Zone:DNS:Edit` and `Zone:Zone:Read`.

### "Record already exists"
The record exists in Cloudflare but not in Terraform state. Use `terraform import` to bring it under management.

### State Conflicts
State is managed remotely via Terraform Cloud, which handles locking automatically. If you see lock errors, check if another operation is in progress at https://app.terraform.io/app/togather/workspaces/cloudflare-dns
