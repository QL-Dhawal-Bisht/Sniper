import spacy
import re
import os
import glob
from collections import Counter

os.chdir('../deepscrape')

# Load spaCy model (more accurate for NER)
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Please install spaCy English model: python -m spacy download en_core_web_sm")
    exit()

def clean_entity(entity):
    """Clean and validate entity text"""
    # Remove extra whitespace and clean artifacts
    entity = re.sub(r'\s+', ' ', entity.strip())
    entity = re.sub(r'[#@]+', '', entity)  # Remove # and @ artifacts
    
    # Skip if too short or contains mostly numbers/symbols
    if len(entity) < 2 or entity.isdigit() or len(re.findall(r'[a-zA-Z]', entity)) < 2:
        return None
    
    # Skip common false positives
    false_positives = {
        'harvard university delhi', 'my network', 'linkedin', 'video streaming technology',
        'computer software', 'information technology', 'dtc', 'ai', 'gt', 'sa', 'web developer',
        'join our team', 'click here', 'product development'
    }
    
    if entity.lower() in false_positives:
        return None
    
    return entity

def extract_entities_using_spacy(text):
    """
    Extract named entities using spaCy (faster and more accurate)
    """
    # Process text with spaCy
    doc = nlp(text)
    
    raw_names = []
    raw_organizations = []
    
    # Extract entities
    for ent in doc.ents:
        cleaned_entity = clean_entity(ent.text)
        if not cleaned_entity:
            continue
            
        if ent.label_ == "PERSON":
            raw_names.append(cleaned_entity)
        elif ent.label_ == "ORG":
            raw_organizations.append(cleaned_entity)
    
    # Remove duplicates and similar entries
    names = list(set(raw_names))
    organizations = list(set(raw_organizations))
    
    # Remove duplicate names (like "Chang Kim Chang Kim")
    names = [name for name in names if not any(name in other and name != other for other in names)]
    
    # Extract URLs and emails using regex
    urls = list(set(re.findall(r'https?://[^\s]+', text)))
    emails = list(set(re.findall(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', text)))
    
    # Extract phone numbers using regex (international formats, customizable)
    phone_numbers = list(set(re.findall(r'\+?\(?\d{1,4}\)?[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}', text)))


    return {
        'names': names,
        'organizations': organizations,
        'urls': urls,
        'emails': emails,
        'phone_numbers': phone_numbers
    }

def process_all_files():
    """
    Process all .txt files in the deepscrape directory
    """
    # Get all .txt files inside the 'deepscrape' directory
    txt_files = glob.glob("*.txt")
    
    if not txt_files:
        print("No .txt files found in the deepscrape directory.")
        return
    
    print(f"Found {len(txt_files)} .txt files to process:")
    for file in txt_files:
        print(f"  - {file}")
    print("\n" + "="*80 + "\n")
    
    # Collect all entities for summary
    all_names = []
    all_organizations = []
    all_urls = []
    all_emails = []
    all_phone_numbers = []
    
    # Process each file
    for filename in txt_files:
        print(f"Processing: {filename}")
        print("-" * 60)
        
        try:
            with open(filename, 'r', encoding='utf-8') as file:
                text = file.read()
            
            # Extract entities
            entities = extract_entities_using_spacy(text)
            
            # Print results
            print(f"Names: {entities['names']}")
            print(f"Organizations: {entities['organizations']}")
            print(f"URLs: {entities['urls']}")
            print(f"Emails: {entities['emails']}")
            print(f"Phone Numbers: {entities['phone_numbers']}")
            
            # Collect for summary
            all_names.extend(entities['names'])
            all_organizations.extend(entities['organizations'])
            all_urls.extend(entities['urls'])
            all_emails.extend(entities['emails'])
            all_phone_numbers.extend(entities['phone_numbers'])
            
        except Exception as e:
            print(f"Error processing {filename}: {str(e)}")
        
        print("\n" + "="*80 + "\n")
    
    # Print summary
    print("SUMMARY - All Unique Entities:")
    print("-" * 60)
    print(f"Total Unique Names: {list(set(all_names))}")
    print(f"Total Unique Organizations: {list(set(all_organizations))}")
    print(f"Total Unique URLs: {list(set(all_urls))}")
    print(f"Total Unique Emails: {list(set(all_emails))}")
    print(f"Total Unique Phone Numbers: {list(set(all_phone_numbers))}")

# Process all files in deepscrape directory
process_all_files()
