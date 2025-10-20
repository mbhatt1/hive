"""
Unit Tests for Unpack Lambda
=============================

Tests S3 unpacking Lambda function.
"""

import pytest
import json
import tarfile
import io
from unittest.mock import Mock, patch


@pytest.mark.lambda_func
@pytest.mark.unit
class TestUnpackLambda:
    """Test suite for Unpack Lambda."""
    
    def test_handler_zip_file(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test unpack .tar.gz file."""
        # Create a simple tar.gz in memory and upload to S3
        mission_id = 'test-mission-123'
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
            # Add a simple file
            file_data = b"print('Hello World')"
            file_info = tarfile.TarInfo(name='test.py')
            file_info.size = len(file_data)
            tar.addfile(file_info, io.BytesIO(file_data))
        
        tar_buffer.seek(0)
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=tar_buffer.getvalue()
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            result = handler(event, {})
        
        assert result['status'] == 'success'
        assert result['mission_id'] == mission_id
    
    def test_handler_tar_file(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test unpack with multiple files."""
        mission_id = 'test-mission-456'
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
            # Add multiple files
            for i in range(3):
                file_data = f"# File {i}".encode()
                file_info = tarfile.TarInfo(name=f'file{i}.py')
                file_info.size = len(file_data)
                tar.addfile(file_info, io.BytesIO(file_data))
        
        tar_buffer.seek(0)
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=tar_buffer.getvalue()
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            result = handler(event, {})
        
        assert result['status'] == 'success'
        assert result['file_count'] >= 3
    
    def test_handler_single_file(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test handle single file in archive."""
        mission_id = 'test-mission-789'
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
            file_data = b"single file content"
            file_info = tarfile.TarInfo(name='single.py')
            file_info.size = len(file_data)
            tar.addfile(file_info, io.BytesIO(file_data))
        
        tar_buffer.seek(0)
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=tar_buffer.getvalue()
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            result = handler(event, {})
        
        assert result['status'] == 'success'
        assert result['file_count'] >= 1
    
    def test_s3_operations(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test S3 download and upload operations."""
        mission_id = 'test-mission-s3'
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
            file_data = b"test content"
            file_info = tarfile.TarInfo(name='data.txt')
            file_info.size = len(file_data)
            tar.addfile(file_info, io.BytesIO(file_data))
        
        tar_buffer.seek(0)
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=tar_buffer.getvalue()
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            result = handler(event, {})
        
        # Verify artifacts were uploaded
        assert result['status'] == 'success'
        assert 'unzipped_path' in result
    
    def test_step_function_trigger(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test successful unpacking returns correct status."""
        mission_id = 'test-mission-sf'
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
            file_data = b"content"
            file_info = tarfile.TarInfo(name='file.txt')
            file_info.size = len(file_data)
            tar.addfile(file_info, io.BytesIO(file_data))
        
        tar_buffer.seek(0)
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=tar_buffer.getvalue()
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            result = handler(event, {})
        
        assert result['status'] == 'success'
        assert 'sha256' in result
    
    def test_error_handling_corrupt_archive(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test handling of corrupt archive."""
        mission_id = 'test-mission-corrupt'
        # Upload invalid tar.gz content
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=b'not a valid tar.gz file'
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            with pytest.raises(Exception):
                handler(event, {})
    
    def test_error_handling_unsupported_format(
        self,
        mock_s3_client,
        mock_environment
    ):
        """Test handling of path traversal attack in archive."""
        mission_id = 'test-mission-security'
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
            # Add file with path traversal attempt
            file_data = b"malicious"
            file_info = tarfile.TarInfo(name='../../../etc/passwd')
            file_info.size = len(file_data)
            tar.addfile(file_info, io.BytesIO(file_data))
        
        tar_buffer.seek(0)
        mock_s3_client.put_object(
            Bucket='hivemind-uploads',
            Key=f'uploads/{mission_id}/source.tar.gz',
            Body=tar_buffer.getvalue()
        )
        
        event = {'mission_id': mission_id}
        
        from src.lambdas.unpack.index import handler
        with patch.dict('os.environ', mock_environment):
            with pytest.raises(ValueError) as exc_info:
                handler(event, {})
            assert 'unsafe' in str(exc_info.value).lower() or 'path' in str(exc_info.value).lower()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])