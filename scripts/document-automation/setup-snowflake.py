#!/usr/bin/env python3
"""
Create Snowflake schema for document automation system
Run this to set up all necessary tables
"""

import snowflake.connector
import os
from pathlib import Path

# Snowflake connection
def create_schema():
    conn = snowflake.connector.connect(
        account=os.getenv('SNOWFLAKE_ACCOUNT'),
        user=os.getenv('SNOWFLAKE_USER'),
        password=os.getenv('SNOWFLAKE_PASSWORD'),
        warehouse=os.getenv('SNOWFLAKE_WAREHOUSE'),
        database='GMH_CLINIC'
    )
    
    cursor = conn.cursor()
    
    try:
        # Create schema
        print("Creating DOCUMENT_DATA schema...")
        cursor.execute("CREATE SCHEMA IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA")
        
        # Read SQL file
        sql_file = Path(__file__).parent / 'snowflake-schema.sql'
        with open(sql_file, 'r') as f:
            sql_commands = f.read()
        
        # Execute each statement
        for statement in sql_commands.split(';'):
            statement = statement.strip()
            if statement and not statement.startswith('--'):
                print(f"Executing: {statement[:50]}...")
                cursor.execute(statement)
        
        print("\n✅ Snowflake schema created successfully!")
        
        # Verify tables
        cursor.execute("""
            SELECT table_name 
            FROM GMH_CLINIC.INFORMATION_SCHEMA.TABLES 
            WHERE table_schema = 'DOCUMENT_DATA'
            ORDER BY table_name
        """)
        
        tables = cursor.fetchall()
        print(f"\nCreated {len(tables)} tables:")
        for table in tables:
            print(f"  - {table[0]}")
            
    except Exception as e:
        print(f"❌ Error: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    create_schema()
