### **Project Hivemind-Prism**
**Engineering Design Document (EDD) v3.3 — Secure Local Ingestion Architecture**

* **Version:** 3.3
* **Status:** Proposed for Implementation
* **Author:** Gemini (in collaboration with Manish Bhatt)
* **Date:** October 20, 2025

### **1. Executive Summary & Vision**

#### **1.1. Vision**
Project Hivemind-Prism is an autonomous security intelligence platform engineered to create a high-fidelity, searchable **archive of security findings**. It is built as a serverless-first application on the AWS cloud, with all cognitive functions powered exclusively by **Amazon Bedrock**. This version extends the platform's reach by introducing a secure ingestion mechanism, allowing it to analyze local codebases from developer workstations or CI/CD build environments, in addition to traditional repository scans.

#### **1.2. Core Problem**
Security analysis at scale produces an overwhelming volume of raw, noisy data from disparate tools. This data lacks context, contains numerous false positives, and is difficult to correlate, making it unactionable. As a result, valuable security signals are lost, and engineering teams are burdened with low-quality alerts. Furthermore, security feedback is often delivered too late in the development cycle, after code is already committed to a central repository. Developers lack a secure, reliable way to submit local, pre-flight code for the same high-quality, AI-driven analysis that is applied to mainline branches.

#### **1.3. Solution**
Hivemind-Prism v3.3 addresses this by introducing a **Secure Ingestion Layer**, comprising a client-side CLI tool and a secure AWS backend. This allows authorized users to securely upload a local project folder directly for analysis. The platform ingests this code and subjects it to the same rigorous, verifiable intelligence synthesis process as any other source. Its primary deliverable remains a pristine, high-signal archive of security findings, accessible via a secure API. This architecture shifts security left, providing high-fidelity feedback at every stage of the development lifecycle while building a long-term, queryable knowledge base of our software's security posture.

---

### **2. Core Architectural Principles**

1.  **Secure Ingestion:** All code is uploaded via a secure, authenticated, and time-limited mechanism. The data is encrypted in transit and at rest, and never exposed to the public internet.
2.  **Verifiable Evidence Chain:** Every archived finding is backed by a non-repudiable, cryptographic link to the **Model Context Protocol (MCP)** tool output that generated the initial evidence, ensuring full auditability.
3.  **In-Context Learning via RAG:** The platform evolves not through opaque model modification, but through the accumulation of an explicit, institutional memory, managed by **Amazon Kendra**.
4.  **Source Agnosticism:** The core analysis engine is decoupled from the ingestion source. It processes a code package identically, whether it originated from a Git repository or a local upload.
5.  **API-First Retrieval:** All stored findings are designed to be consumed programmatically, enabling integration with other security and business intelligence tools.
6.  **Serverless-First:** All components are ephemeral to achieve near-zero idle cost and massive scalability. Compute is provisioned only when a review is active.
7.  **Least Privilege:** All components operate under the most restrictive IAM policies possible to minimize the blast radius of any potential compromise.

---

### **3. Detailed Architectural Specification**

This section breaks down the platform into its constituent architectural domains: Network, Security, Data, Compute, and Observability.

#### **3.1. Network Architecture**
The entire system operates within a dedicated **Amazon Virtual Private Cloud (VPC)** to ensure network isolation and security.
* **VPC Configuration:**
    * CIDR Block: A non-overlapping private IP range (e.g., `10.10.0.0/16`).
    * Subnet Strategy: The VPC is segmented into at least two Availability Zones (AZs) for high availability. Each AZ contains:
        * **Public Subnets:** For internet-facing resources like the NAT Gateway. No compute resources for the application will reside here.
        * **Private Subnets:** For all AWS Lambda functions and AWS Fargate tasks. These subnets have no direct route to the Internet Gateway.
        * **Isolated Subnets:** For data stores like ElastiCache, ensuring they have no outbound internet access at all.
* **Traffic Flow:**
    * **Ingress:** The only entry point is the **Amazon API Gateway** (Ingestion API). It is a Regional endpoint, not Edge-optimized, to keep traffic within our primary AWS region.
    * **Egress:** Outbound internet traffic from Lambda functions or Fargate tasks (e.g., to pull a container image or a dependency) is routed through a **NAT Gateway** located in a public subnet. This provides a stable IP address and prevents private resources from being directly addressable.
    * **Internal Communication:** All communication between AWS services (e.g., Lambda to S3, Fargate to ECR) is configured to use **VPC Gateway Endpoints** (for S3 and DynamoDB) and **Interface Endpoints** (for ECR, STS, Bedrock, etc.). This ensures traffic remains on the private AWS backbone and never traverses the public internet, which is more secure and often more cost-effective.

#### **3.2. The Secure Ingestion Layer (New)**

This is the new entry point for the system, replacing the passive Git webhook.

##### **3.2.1. The `hivemind-cli` (Client-Side Tool)**
* **Implementation:** A cross-platform binary built in Go for performance and ease of distribution. It will be compiled for Linux (amd64, arm64), macOS (amd64, arm64), and Windows (amd64).
* **Authentication Flow (STS AssumeRole):**
    1.  The CLI is executed by a user or a CI/CD role (`SourceRole`).
    2.  `SourceRole` must have a trust policy allowing it to assume `HivemindCliUserRole`.
    3.  The CLI calls `sts:AssumeRole` to obtain temporary, short-lived credentials for the `HivemindCliUserRole`.
    4.  `HivemindCliUserRole` has a single permission: `execute-api:Invoke` on the ARN of our Ingestion API Gateway endpoint.
    5.  All subsequent API calls are signed with these temporary credentials.
* **Workflow Logic:**
    1.  **Initialization:** The CLI parses arguments (`--path`, `--repo-name`, etc.). It calculates the SHA256 checksum of the uncompressed source code to be included as metadata.
    2.  **Archiving:** It creates a `.tar.gz` archive of the target directory, respecting `.gitignore` files to exclude unnecessary files.
    3.  **Pre-signed URL Request:** It makes a signed `POST` request to `https://api.hivemind.example.com/v1/ingest/request-upload`. The request body includes metadata like the canonical repo name and the source code checksum.
    4.  **Secure Upload:** It receives a `200 OK` response with a JSON payload containing the `mission_id` and the pre-signed S3 `uploadUrl`. It then performs a `PUT` request directly to the S3 URL, including the `Content-SHA256` header for data integrity validation by S3.
    5.  **Confirmation:** If the `--wait` flag is used, it will poll a `GET /ingest/status/{missionId}` endpoint until the status is `COMPLETED` or `FAILED`.

##### **3.2.2. The Ingestion API & Backend**
* **Service:** Amazon API Gateway (REST API) with AWS_IAM authorization.
* **Backend:** An `IngestionHandler` AWS Lambda function.
* **Logic:**
    1.  The `IngestionHandler` Lambda is invoked upon a successful IAM-authenticated request.
    2.  It generates a unique `mission_id` (UUIDv4).
    3.  It calls `s3:generate_presigned_url` for a `put_object` operation. The key will be `uploads/{mission_id}/source.tar.gz`. The URL is generated with a 15-minute TTL and a condition requiring the `Content-SHA256` header to be present.
    4.  It writes a "PENDING" record to the DynamoDB `HivemindMissions` table.
    5.  It returns the `mission_id` and the `uploadUrl` to the CLI client.

##### **3.2.3. The Ingestion S3 Bucket (`hivemind-uploads`)**
* **Configuration:**
    * **Block All Public Access:** Enabled.
    * **Default Encryption:** Enabled (SSE-KMS with a customer-managed KMS key).
    * **Versioning:** Enabled.
    * **Event Notifications:** Configured to send an `s3:ObjectCreated:*` event to an Amazon EventBridge bus.
    * **Lifecycle Policy:** Objects in the `uploads/` prefix are transitioned to S3 Infrequent Access after 1 day and permanently deleted after 7 days.

#### **3.3. Orchestration & Compute**

* **AWS Step Functions:** The orchestrator, as detailed previously. Its IAM role (`StepFunctionsRole`) will have permissions to invoke all necessary Lambdas and run Fargate tasks.
* **UnpackAndPrepare Lambda:** The first state in the workflow. It downloads the archive, validates its checksum against the metadata, unzips it to a working location in the `hivemind-artifacts` bucket, and performs a basic malware scan using a sandboxed ClamAV process. This is a critical security control to prevent malicious code from reaching the analysis tools.

#### **3.4. The Findings Archive & Retrieval API**

* **Database:** Amazon DynamoDB table (`FindingsArchive`).
* **Retrieval API:** Amazon API Gateway with IAM authorization.
* **API Specification:** See Section 7.

---

### **4. Security Architecture & IAM**

Security is paramount. This section details the specific IAM roles and policies.

* **`HivemindCliUserRole`:**
    * **Trusted by:** Developer/CI roles.
    * **Permissions:** `execute-api:Invoke` on the Ingestion API Gateway ARN. No other permissions.
* **`IngestionHandlerLambdaRole`:**
    * **Permissions:** `s3:PutObject` (via `generate_presigned_url`), `dynamodb:PutItem` on `HivemindMissions` table.
* **`StepFunctionsRole`:**
    * **Permissions:** `lambda:InvokeFunction` on all agent Lambdas, `fargate:RunTask` on the defined Fargate task definitions, `iam:PassRole` for the `MCPServerTaskRole`.
* **`CognitiveKernelLambdaRole`:**
    * **Permissions:** `bedrock:InvokeModel`, `kendra:Retrieve`, `lambda:InvokeFunction`, `fargate:RunTask`, etc. The most privileged role, its policy should be meticulously reviewed.
* **`MCPServerTaskRole`:**
    * **Permissions:** Read-only access to the unzipped source code in the `hivemind-artifacts` bucket, write-only access to a results prefix. No network permissions beyond what's required by the VPC endpoints.
* **KMS Keys:** A dedicated, customer-managed KMS key (`HivemindKey`) will be used for encryption across S3, DynamoDB, and other services to allow for centralized key management and rotation.

---

### **5. End-to-End Workflow: A Narrative Journey**

1.  **Initiation:** A developer on their local machine runs: `hivemind scan --path . --repo-name "auth-service"`.

2.  **Secure Upload:** The CLI assumes the `HivemindCliUserRole`, gets a pre-signed URL from the Ingestion API, and securely uploads the `source.tar.gz` directly to the `hivemind-uploads` S3 bucket.

3.  **Triggering Analysis:** The S3 `ObjectCreated` event triggers the Step Functions state machine for `mission_id: 3e4f5g6h`.

4.  **Preparation:** The `UnpackAndPrepare` state runs, unzipping the code and verifying it is clean.

5.  **Context Acquisition:** The `ContextAcquisition` state launches the `Archaeologist` and `Auditor` agents. They analyze the unzipped code, discover the service is Tier-0 and handles PII, and load this context into the mission state.

6.  **Evidence Gathering (MCP):** The Cognitive Kernel's plan is to get full coverage. It launches Fargate tasks for the open-source MCP fleet.
    * `semgrep-mcp` finds an insecure hashing algorithm being used. Digest: `sha256:ddd...`.
    * `gitleaks-mcp` finds an exposed test credential. Digest: `sha256:eee...`.

7.  **The Crucible with Kendra RAG:** The `SynthesizerAgent` drafts two findings. Before invoking the `Critic`, the Kernel queries Kendra: "Analysis of hashing algorithms in auth-service." Kendra retrieves a memory from a past security architecture review: `security-policy-auth.md`, which states: "All password hashing must use Argon2id. MD5 is explicitly forbidden for any purpose." The augmented prompt leads the `Critic` to confirm the insecure hashing algorithm is a **CRITICAL** finding.

8.  **Archival & Learning:** The `ArchivistAgent` writes the findings to the `FindingsArchive` DynamoDB table. The `MemoryIngestor` Lambda creates a new memory document and saves it to S3 for Kendra to index.

9.  **Retrieval (Later):** The developer can then use the CLI (`hivemind get-findings --mission-id 3e4f5g6h`) or a web dashboard to call the **Findings Retrieval API** to view the detailed results.

---

### **6. CLI Specification**

* **Command:** `hivemind`
* **Subcommands:**
    * **`scan`**: Initiates a scan.
        * `--path <string>` (Required): The local file path to the folder.
        * `--repo-name <string>` (Required): The canonical repository name.
        * `--profile <string>` (Optional): The AWS profile to use.
        * `--wait` (Optional, flag): Wait for completion.
    * **`get-findings`**: Retrieves results.
        * `--mission-id <string>` (Required): The mission ID returned by the `scan` command.
        * `--format <json|table>` (Optional): Output format.

---

### **7. Findings Retrieval API Specification**

* **Authentication:** All endpoints require AWS IAM credentials (Signature Version 4).
* **Base URL:** `https://api.hivemind.example.com/v1`
* **Endpoints:**
    * `GET /findings`: Retrieve a list of findings with filters.
    * `GET /findings/{findingId}`: Retrieve a single finding.
    * `GET /stats/repository`: Retrieve aggregate statistics.
    * `GET /ingest/status/{missionId}`: Get the status of an ongoing mission.

---

### **8. Conclusion**

This design specifies Project Hivemind-Prism as a versatile and powerful security intelligence platform. By introducing a **Secure Ingestion Layer** and a **developer-friendly CLI**, it extends its advanced analysis capabilities beyond cloud repositories to local workstations and CI/CD environments. This allows developers to get high-quality, AI-synthesized feedback earlier in the development process. The core of the system remains the robust, serverless analysis engine that leverages Amazon Kendra to learn and improve over time, ensuring that all findings, regardless of their source, are archived as a single, verifiable, and authoritative system of record.