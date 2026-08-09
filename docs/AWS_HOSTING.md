# AWS Hosting for AbbaSeo

This guide explains how to deploy AbbaSeo on AWS in a single command using our CloudFormation stack.

AbbaSeo is containerized and run locally via Docker inside an EC2 instance, managed by a Caddy reverse proxy for speed, efficiency, and automatic HTTPS capabilities.

## Architecture

- **EC2 Instance (`t3.medium`)**: Adequate CPU and 4GB RAM to prevent Out-of-Memory (OOM) errors during Vite builds.
- **EBS Disk (30GB gp3)**: Persistent, fast storage for your local SQLite/D1 database and credentials.
- **Elastic IP (Static IP)**: Guarantees your server has a static IP address across restarts.
- **Caddy Reverse Proxy**: Serves requests over port 80/443, handling automatic SSL/TLS certificate renewal and proxying traffic to the AbbaSeo Docker container.

---

## Prerequisites

1. Installed **AWS CLI** configured with credentials (administrator privileges for EC2, VPC, EIP, and CloudFormation).
2. The **DataForSEO API Key** (login:password) ready in your `.env` file (or set as `DATAFORSEO_API_KEY` in your shell environment).
3. (Optional) **OpenRouter API Key** for AI features (SAM and Onboarding chat).

---

## One-Click Deployment

Simply run the deploy script from your terminal:

```bash
./deploy/aws/deploy.sh
```

### What this script does:

1. Detects your existing `.env` file and pulls `DATAFORSEO_API_KEY` and `OPENROUTER_API_KEY`.
2. Validates your AWS CLI environment.
3. Launches the CloudFormation stack `abbaseo-app` in `us-east-1` (configurable via `AWS_REGION` or `STACK_NAME`).
4. Boots up a fresh Ubuntu 24.04 server, installs Docker, pulls the codebase, writes your `.env`, builds the Docker image, and starts the container automatically.
5. Outputs the public Elastic IP and live URLs when complete.

---

## Customizing Deployment

### Change AWS Region or Stack Name

To deploy to a different region or customize the stack name:

```bash
AWS_REGION=us-west-2 STACK_NAME=my-abbaseo ./deploy/aws/deploy.sh
```

### Map a Custom Domain with SSL

1. Point an `A` record for your domain (e.g., `seo.yourdomain.com`) to the **Elastic IP** output by the deployment script.
2. SSH into your EC2 instance:
   ```bash
   ssh -i /path/to/key.pem ubuntu@<ElasticIP>
   ```
3. Edit the Caddyfile to use your domain:
   ```bash
   sudo nano /etc/caddy/Caddyfile
   ```
4. Replace `:80` with your domain:
   ```caddy
   seo.yourdomain.com {
       reverse_proxy 127.0.0.1:3001
       encode gzip zstd
       header {
           X-Content-Type-Options "nosniff"
           X-Frame-Options "SAMEORIGIN"
       }
   }
   ```
5. Reload Caddy:
   ```bash
   sudo systemctl reload caddy
   ```
   Caddy will automatically fetch a let's encrypt TLS certificate and provision HTTPS (`https://seo.yourdomain.com`) in seconds.

---

## Maintenance & Logs

To see setup/install progress on your new server:

```bash
# SSH into the server and view Cloud-Init logs
tail -f /var/log/abbaseo-setup.log
```

To view application logs from Docker:

```bash
cd /opt/abbaseo
sudo docker compose logs -f
```

To restart the application:

```bash
cd /opt/abbaseo
sudo docker compose restart
```

---

## Security Recommendations

AbbaSeo runs in `AUTH_MODE=local_noauth` for single-user Docker self-hosts. To protect your server from unauthorized public web access:

1. **Restrict Security Group**: Limit ingress on port 80/443 to your office or home IP address in the AWS Security Group settings.
2. **Add Basic Auth (Recommended)**: Edit `/etc/caddy/Caddyfile` on the EC2 instance and add a basic auth wrapper:
   ```caddy
   seo.yourdomain.com {
       basic_auth {
           # Generate hash via: caddy hash-password --plaintext yourpassword
           admin JDJhJDEwJEVYSkswZ...
       }
       reverse_proxy 127.0.0.1:3001
   }
   ```
3. Reload caddy (`sudo systemctl reload caddy`) to lock the application behind a password screen.
