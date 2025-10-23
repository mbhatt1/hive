"""
Critic Agent - Finding Validation and Challenge
Reviews and challenges draft findings from Synthesizer.
"""

import os
import json
import boto3
import redis
import logging
from typing import List, Dict
import sys

from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CriticAgent:
    def __init__(self, scan_id: str = None):
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        self.kendra_index_id = os.environ.get('KENDRA_INDEX_ID', 'test-kendra-index')
        
        # Connect to Redis with retry logic
        self.redis_client = self._connect_redis_with_retry()
        
        self.cognitive_kernel = CognitiveKernel(kendra_index_id=self.kendra_index_id)
        logger.info(f"CriticAgent initialized for mission: {self.mission_id}")
    
    def _connect_redis_with_retry(self, max_retries=3):
        """Connect to Redis with exponential backoff retry."""
        import time
        for attempt in range(max_retries):
            try:
                client = redis.Redis(
                    host=self.redis_endpoint,
                    port=self.redis_port,
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5,
                    retry_on_timeout=True
                )
                client.ping()
                logger.info(f"Redis connection established")
                return client
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt
                    logger.warning(f"Redis connection failed (attempt {attempt+1}/{max_retries}): {e}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"Redis connection failed after {max_retries} attempts")
                    raise RuntimeError(f"Failed to connect to Redis at {self.redis_endpoint}:{self.redis_port}") from e
    
    def run(self):
        try:
            self._update_state("SENSING")
            proposals = self._read_proposals()
            
            self._update_state("THINKING")
            reviews = self._review_findings(proposals)
            
            self._update_state("ACTING")
            self._write_counterproposals(reviews)
            
            self._update_state("COMPLETED", sum(r['confidence'] for r in reviews) / max(len(reviews), 1))
            logger.info(f"CriticAgent completed {len(reviews)} reviews")
        except Exception as e:
            logger.error(f"CriticAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
    
    def _read_proposals(self) -> List[Dict]:
        proposals = self.redis_client.lrange(f"negotiation:{self.mission_id}:proposals", 0, -1)
        parsed_proposals = []
        for p in proposals:
            if not p:
                continue
            try:
                parsed_proposals.append(json.loads(p))
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse proposal from Redis: {e}. Skipping.")
                continue
        return parsed_proposals
    
    def _review_findings(self, proposals: List[Dict]) -> List[Dict]:
        system_prompt = """You are the CriticAgent. Challenge and validate security findings.

For each finding:
1. Check for false positives
2. Validate severity assignment
3. Query historical data for similar patterns
4. Propose adjustments or confirm"""

        reviews = []
        for proposal in proposals:
            # Validate proposal structure
            if not isinstance(proposal, dict):
                logger.warning(f"Invalid proposal type: {type(proposal)}. Skipping.")
                continue
            
            if proposal.get('agent') != 'synthesizer':
                continue
            
            finding = proposal.get('payload')
            if not finding:
                logger.warning("Proposal missing payload. Skipping.")
                continue
            
            # Query Kendra for counter-evidence
            kendra_ctx = self.cognitive_kernel.retrieve_from_kendra(
                query=f"{finding['title']} false positive patterns",
                top_k=3
            )
            
            user_prompt = f"""Review this finding:
Title: {finding['title']}
Severity: {finding['severity']}
Description: {finding['description']}
File: {finding['file_path']} (lines {finding['line_numbers']})
Confidence: {finding['confidence_score']}

Historical Context:
{self._format_kendra(kendra_ctx)}

Provide review in JSON:
{{
  "action": "CONFIRM" or "CHALLENGE",
  "revised_severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "rationale": "explanation",
  "confidence": 0.0-1.0
}}"""

            response = self.cognitive_kernel.invoke_claude(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.2
            )
            
            try:
                review = json.loads(response.content)
                review['finding_id'] = finding['finding_id']
                reviews.append(review)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Claude response for finding {finding['finding_id']}: {e}")
                # Create default CONFIRM review on parse failure
                reviews.append({
                    'finding_id': finding['finding_id'],
                    'action': 'CONFIRM',
                    'revised_severity': finding['severity'],
                    'rationale': f'JSON parse error, confirming original assessment',
                    'confidence': 0.5
                })
        
        return reviews
    
    def _write_counterproposals(self, reviews: List[Dict]):
        import time
        proposal_key = f"negotiation:{self.mission_id}:proposals"
        for review in reviews:
            self.redis_client.rpush(
                proposal_key,
                json.dumps({
                    'agent': 'critic',
                    'action': review['action'],
                    'payload': review,
                    'timestamp': int(time.time())
                })
            )
        
        # Set 24-hour TTL on proposal key to prevent memory leak
        self.redis_client.expire(proposal_key, 86400)
        logger.info(f"Wrote {len(reviews)} counterproposals")
    
    def _update_state(self, status: str, confidence: float = 0.0, error: str = None):
        import time
        state = {'status': status, 'last_heartbeat': str(int(time.time())), 'confidence_score': str(confidence)}
        if error:
            state['error_message'] = error
        
        state_key = f"agent:{self.mission_id}:critic"
        self.redis_client.hset(state_key, mapping=state)
        # Set 24-hour TTL on agent state to prevent memory leak
        self.redis_client.expire(state_key, 86400)
    
    def _format_kendra(self, ctx) -> str:
        if not ctx or not ctx.documents:
            return "No context"
        return "\n".join([f"- {d['title']}" for d in ctx.documents[:2]])
    
    def _create_counter_proposal(self, proposal):
        """Create a counter-proposal for a finding."""
        # This is a placeholder for the negotiation protocol
        counter = {
            'finding_id': proposal.get('finding_id'),
            'action': 'CHALLENGE',
            'revised_severity': proposal.get('severity', 'MEDIUM'),
            'rationale': 'Counter-proposal based on analysis'
        }
        return counter
    
    def _check_consensus(self, votes):
        """Check if consensus has been reached on votes."""
        # Simple majority voting
        for finding_id, vote_counts in votes.items():
            validate = vote_counts.get('validate', 0)
            reject = vote_counts.get('reject', 0)
            if validate > reject:
                return True
        return False
    
    def _wait_for_consensus(self, timeout=60):
        """Wait for consensus to be reached with timeout."""
        import time
        start_time = time.time()
        while time.time() - start_time < timeout:
            # Check for consensus in Redis
            consensus_key = f"negotiation:{self.mission_id}:consensus"
            consensus = self.redis_client.get(consensus_key)
            if consensus:
                return json.loads(consensus)
            time.sleep(1)
        raise TimeoutError("Consensus timeout reached")

def main():
    agent = CriticAgent()
    agent.run()
    output = {
        'mission_id': agent.mission_id,
        'status': 'completed'
    }
    print(json.dumps(output))
    return 0

if __name__ == "__main__":
    exit(main())