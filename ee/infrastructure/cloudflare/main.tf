terraform {
  required_version = ">= 1.5.0"

  # Remote state via Terraform Cloud
  # Requires TF_API_TOKEN environment variable (set in GitHub Actions secrets)
  cloud {
    organization = "togather"
    workspaces {
      name = "cloudflare-dns"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Data source to look up the zone by name
data "cloudflare_zone" "togather" {
  name = "togather.nyc"
}
