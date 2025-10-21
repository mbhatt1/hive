#!/usr/bin/env python3
"""
Hivemind-Prism CLI Tool
Secure code submission with IAM authentication
"""

import click
import boto3
import json
import tarfile
import hashlib
import time
import os
from pathlib import Path
from typing import Optional
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
import sys

console = Console()

class HivemindClient:
    """Client for interacting with Hivemind-Prism platform."""
    
    def __init__(self, region: str = "us-west-2", profile: Optional[str] = None):
        """Initialize client with AWS credentials."""
        session = boto3.Session(profile_name=profile, region_name=region)
        
        # Assume CLI user role
        sts = session.client('sts')
        
        try:
            # Get CLI user role ARN from CloudFormation outputs or environment
            cli_role_arn = os.environ.get(
                'HIVEMIND_CLI_ROLE_ARN',
                f'arn:aws:iam::{sts.get_caller_identity()["Account"]}:role/HivemindCliUserRole'
            )
            
            assumed_role = sts.assume_role(
                RoleArn=cli_role_arn,
                RoleSessionName='hivemind-cli-session',
                DurationSeconds=3600
            )
            
            credentials = assumed_role['Credentials']
            
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=credentials['AccessKeyId'],
                aws_secret_access_key=credentials['SecretAccessKey'],
                aws_session_token=credentials['SessionToken'],
                region_name=region
            )
            
            self.dynamodb_client = boto3.client(
                'dynamodb',
                aws_access_key_id=credentials['AccessKeyId'],
                aws_secret_access_key=credentials['SecretAccessKey'],
                aws_session_token=credentials['SessionToken'],
                region_name=region
            )
            
            self.uploads_bucket = os.environ.get('HIVEMIND_UPLOADS_BUCKET', f'hivemind-uploads-{sts.get_caller_identity()["Account"]}')
            self.mission_table = os.environ.get('HIVEMIND_MISSION_TABLE', 'HivemindMissionStatus')
            
            console.print("[green]✓[/green] Authenticated with AWS")
            
        except Exception as e:
            console.print(f"[red]✗[/red] Authentication failed: {str(e)}")
            raise
    
    def scan(self, path: str, repo_name: str, wait: bool = False) -> str:
        """
        Scan local code directory.
        
        Args:
            path: Local directory path
            repo_name: Repository name
            wait: Wait for completion
            
        Returns:
            Mission ID
        """
        # Generate mission ID
        import uuid
        mission_id = str(uuid.uuid4())
        
        console.print(f"\n[bold]Scanning:[/bold] {path}")
        console.print(f"[bold]Mission ID:[/bold] {mission_id}")
        
        # Create archive
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("Creating archive...", total=None)
            
            archive_path = self._create_archive(Path(path), mission_id)
            sha256 = self._compute_checksum(archive_path)
            
            progress.update(task, description=f"Archive created: {archive_path.name}")
        
        # Upload to S3
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("Uploading to S3...", total=None)
            
            s3_key = f"uploads/{mission_id}/source.tar.gz"
            
            self.s3_client.upload_file(
                str(archive_path),
                self.uploads_bucket,
                s3_key,
                ExtraArgs={
                    'Metadata': {
                        'mission-id': mission_id,
                        'repo-name': repo_name,
                        'sha256': sha256
                    }
                }
            )
            
            progress.update(task, description="Upload complete")
        
        # Upload metadata
        metadata = {
            'mission_id': mission_id,
            'repo_name': repo_name,
            'sha256': sha256,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'uploader_arn': boto3.client('sts').get_caller_identity()['Arn']
        }
        
        self.s3_client.put_object(
            Bucket=self.uploads_bucket,
            Key=f"uploads/{mission_id}/metadata.json",
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        
        console.print(f"\n[green]✓[/green] Code uploaded successfully")
        console.print(f"[cyan]s3://{self.uploads_bucket}/{s3_key}[/cyan]")
        
        # Clean up
        archive_path.unlink()
        
        if wait:
            return self._wait_for_completion(mission_id)
        
        return mission_id
    
    def get_status(self, mission_id: str) -> dict:
        """Get mission status from DynamoDB."""
        try:
            response = self.dynamodb_client.get_item(
                TableName=self.mission_table,
                Key={'mission_id': {'S': mission_id}}
            )
            
            if 'Item' not in response:
                return {'status': 'NOT_FOUND'}
            
            item = response['Item']
            
            return {
                'mission_id': mission_id,
                'status': item.get('status', {}).get('S', 'UNKNOWN'),
                'findings_count': int(item.get('findings_count', {}).get('N', 0)),
                'last_updated': item.get('last_updated', {}).get('S', 'N/A')
            }
            
        except Exception as e:
            console.print(f"[red]✗[/red] Failed to get status: {str(e)}")
            return {'status': 'ERROR', 'error': str(e)}
    
    def _wait_for_completion(self, mission_id: str, timeout: int = 300) -> str:
        """Wait for mission to complete."""
        console.print("\n[yellow]⏳[/yellow] Waiting for analysis to complete...")
        
        start_time = time.time()
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("Analyzing...", total=None)
            
            while time.time() - start_time < timeout:
                status = self.get_status(mission_id)
                
                if status['status'] == 'COMPLETED':
                    progress.update(task, description="Analysis complete!")
                    console.print(f"\n[green]✓[/green] Analysis completed")
                    console.print(f"[bold]Findings:[/bold] {status['findings_count']}")
                    return mission_id
                elif status['status'] == 'FAILED':
                    progress.update(task, description="Analysis failed")
                    console.print(f"\n[red]✗[/red] Analysis failed")
                    return mission_id
                
                progress.update(task, description=f"Status: {status['status']}")
                time.sleep(5)
        
        console.print(f"\n[yellow]⚠[/yellow] Timeout waiting for completion")
        return mission_id
    
    def _create_archive(self, path: Path, mission_id: str) -> Path:
        """Create tar.gz archive of directory."""
        archive_path = Path(f"/tmp/hivemind-{mission_id}.tar.gz")
        
        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(path, arcname=".")
        
        return archive_path
    
    def _compute_checksum(self, file_path: Path) -> str:
        """Compute SHA256 checksum."""
        sha256 = hashlib.sha256()
        
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256.update(chunk)
        
        return sha256.hexdigest()

@click.group()
@click.version_option(version="1.0.0")
def cli():
    """Hivemind-Prism CLI - Secure code security analysis"""
    pass

@cli.command()
@click.option('--path', required=True, help='Path to code directory')
@click.option('--repo-name', required=True, help='Repository name')
@click.option('--profile', default=None, help='AWS profile name')
@click.option('--region', default='us-west-2', help='AWS region')
@click.option('--wait', is_flag=True, help='Wait for completion')
def scan(path: str, repo_name: str, profile: Optional[str], region: str, wait: bool):
    """Scan local code directory for security issues."""
    try:
        client = HivemindClient(region=region, profile=profile)
        mission_id = client.scan(path, repo_name, wait=wait)
        
        console.print(f"\n[bold cyan]Mission ID:[/bold cyan] {mission_id}")
        console.print("\n[dim]Run 'hivemind status --mission-id <ID>' to check progress[/dim]")
        
    except Exception as e:
        console.print(f"\n[red]Error:[/red] {str(e)}")
        sys.exit(1)

@cli.command()
@click.option('--mission-id', required=True, help='Mission ID')
@click.option('--profile', default=None, help='AWS profile name')
@click.option('--region', default='us-west-2', help='AWS region')
def status(mission_id: str, profile: Optional[str], region: str):
    """Check mission status."""
    try:
        client = HivemindClient(region=region, profile=profile)
        status_data = client.get_status(mission_id)
        
        table = Table(title=f"Mission Status: {mission_id}")
        table.add_column("Attribute", style="cyan")
        table.add_column("Value", style="green")
        
        for key, value in status_data.items():
            table.add_row(key, str(value))
        
        console.print(table)
        
    except Exception as e:
        console.print(f"\n[red]Error:[/red] {str(e)}")
        sys.exit(1)

@cli.command()
@click.option('--mission-id', required=True, help='Mission ID')
@click.option('--format', type=click.Choice(['json', 'table']), default='table', help='Output format')
@click.option('--profile', default=None, help='AWS profile name')
@click.option('--region', default='us-west-2', help='AWS region')
def get_findings(mission_id: str, format: str, profile: Optional[str], region: str):
    """Retrieve findings for a mission."""
    console.print(f"[yellow]⚠[/yellow] Findings retrieval not yet implemented")
    console.print(f"Mission ID: {mission_id}")
    # TODO: Implement findings retrieval from DynamoDB

def main():
    """Main entry point for the CLI."""
    cli()

if __name__ == '__main__':
    main()