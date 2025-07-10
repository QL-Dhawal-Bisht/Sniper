import spacy
import re
import os
import glob
from collections import Counter
import phonenumbers
from phonenumbers import geocoder, carrier
from urllib.parse import urlparse

os.chdir('../deepscrape')

# Load spaCy model with better configuration
try:
    nlp = spacy.load("en_core_web_sm")
    # Disable unnecessary components for speed
    nlp.disable_pipes(["tagger", "parser", "attribute_ruler", "lemmatizer"])
except OSError:
    print("Please install spaCy English model: python -m spacy download en_core_web_sm")
    exit()

def is_valid_person_name(name):
    """Enhanced validation for person names"""
    name = name.strip()
    
    # Skip if too short or too long
    if len(name) < 2 or len(name) > 50:
        return False
    
    # Must contain at least one letter
    if not re.search(r'[a-zA-Z]', name):
        return False
    
    # Skip if mostly numbers
    if sum(c.isdigit() for c in name) > len(name) * 0.3:
        return False
    
    # Skip common false positives
    false_positives = {
        'linkedin', 'facebook', 'twitter', 'instagram', 'youtube', 'google',
        'microsoft', 'apple', 'amazon', 'tesla', 'nike', 'adidas',
        'web developer', 'software engineer', 'data scientist', 'product manager',
        'marketing', 'sales', 'customer success', 'business development',
        'artificial intelligence', 'machine learning', 'deep learning',
        'university', 'college', 'school', 'company', 'corporation',
        'inc', 'llc', 'ltd', 'pvt', 'technologies', 'solutions', 'services',
        'consulting', 'management', 'development', 'systems', 'software',
        'mobile app', 'web app', 'saas', 'b2b', 'api', 'cloud computing',
        'big data', 'analytics', 'blockchain', 'cybersecurity', 'fintech',
        'healthtech', 'edtech', 'proptech', 'insurtech', 'regtech',
        'click here', 'learn more', 'read more', 'contact us', 'about us',
        'privacy policy', 'terms of service', 'cookie policy'
    }
    
    if name.lower() in false_positives:
        return False
    
    # Skip if contains common business/tech terms
    business_terms = ['ceo', 'cto', 'cfo', 'coo', 'vp', 'director', 'manager',
                     'lead', 'senior', 'junior', 'intern', 'consultant',
                     'analyst', 'specialist', 'expert', 'advisor', 'founder',
                     'co-founder', 'entrepreneur', 'investor', 'partner']
    
    name_lower = name.lower()
    if any(term in name_lower for term in business_terms):
        # Allow if it's likely a real name with title (e.g., "CEO John Smith")
        words = name.split()
        if len(words) >= 2 and any(word.lower() not in business_terms for word in words):
            return True
        return False
    
    # Skip if contains URLs or email-like patterns
    if '@' in name or 'http' in name or '.com' in name or '.org' in name:
        return False
    
    # Skip if contains too many special characters
    special_chars = sum(1 for c in name if not c.isalnum() and c != ' ' and c != '.' and c != '-' and c != "'")
    if special_chars > 3:
        return False
    
    # Skip if all caps and longer than 4 characters (likely acronym)
    if name.isupper() and len(name) > 4:
        return False
    
    return True

def is_valid_organization(org):
    """Enhanced validation for organization names"""
    org = org.strip()
    
    # Skip if too short or too long
    if len(org) < 2 or len(org) > 100:
        return False
    
    # Must contain at least one letter
    if not re.search(r'[a-zA-Z]', org):
        return False
    
    # Skip if mostly numbers
    if sum(c.isdigit() for c in org) > len(org) * 0.5:
        return False
    
    # Skip common false positives
    false_positives = {
        'linkedin', 'facebook', 'twitter', 'instagram', 'youtube',
        'click here', 'learn more', 'read more', 'contact us', 'about us',
        'privacy policy', 'terms of service', 'cookie policy',
        'web developer', 'software engineer', 'data scientist',
        'artificial intelligence', 'machine learning', 'deep learning',
        'mobile app development', 'web development', 'app development',
        'digital marketing', 'social media marketing', 'content marketing',
        'search engine optimization', 'seo', 'sem', 'ppc', 'cpc',
        'user experience', 'user interface', 'ux', 'ui', 'ux/ui',
        'information technology', 'computer software', 'software development',
        'cloud computing', 'big data', 'data analytics', 'business analytics',
        'custom software development', 'mobile application development',
        'e-commerce development', 'website development', 'web design',
        'jobs engineering', 'jobs marketing', 'jobs sales', 'jobs designer',
        'actively hiring', 'hiring', 'recruitment', 'staffing',
        'remote work', 'work from home', 'freelance', 'contract'
    }
    
    if org.lower() in false_positives:
        return False
    
    # Skip if contains URLs or email-like patterns
    if '@' in org or 'http' in org:
        return False
    
    # Skip if it's just a job title or department
    job_patterns = [
        r'\b(ceo|cto|cfo|coo|vp|director|manager|lead|senior|junior)\b',
        r'\b(marketing|sales|engineering|development|design|hr|finance)\b',
        r'\b(team|department|division|unit|group)\b'
    ]
    
    if any(re.search(pattern, org.lower()) for pattern in job_patterns) and len(org.split()) <= 3:
        return False
    
    return True

def clean_url(url):
    """Clean and validate URLs"""
    url = url.strip()
    
    # Remove trailing punctuation
    url = re.sub(r'[.,;!?]+$', '', url)
    
    # Skip if not a valid URL format
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return None
    except:
        return None
    
    # Skip common false positives
    if any(domain in url.lower() for domain in ['example.com', 'test.com', 'localhost']):
        return None
    
    return url

def extract_phone_numbers(text):
    """Extract phone numbers using phonenumbers library for better accuracy"""
    phone_numbers = []
    
    # Common regions to try
    regions = ['US', 'IN', 'GB', 'CA', 'AU']
    
    # More specific regex patterns for phone numbers
    phone_patterns = [
        r'\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}',  # International
        r'\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}',  # US format (123) 456-7890
        r'\d{3}[-.\s]?\d{3}[-.\s]?\d{4}',       # US format 123-456-7890
        r'\+91[-.\s]?\d{10}',                   # India format
        r'\d{10}',                              # 10-digit numbers
    ]
    
    for pattern in phone_patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            # Skip if it's clearly not a phone number
            if re.search(r'\d{4}-\d{4}', match):  # Skip years like 2023-2024
                continue
            if len(re.findall(r'\d', match)) < 7:  # Too few digits
                continue
            if len(re.findall(r'\d', match)) > 15:  # Too many digits
                continue
            
            # Try to parse with phonenumbers library
            for region in regions:
                try:
                    parsed = phonenumbers.parse(match, region)
                    if phonenumbers.is_valid_number(parsed):
                        formatted = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
                        phone_numbers.append(formatted)
                        break
                except:
                    continue
    
    return list(set(phone_numbers))

def extract_entities_enhanced(text):
    """
    Enhanced entity extraction with better filtering
    """
    # Process text with spaCy
    doc = nlp(text)
    
    raw_names = []
    raw_organizations = []
    
    # Extract entities using spaCy
    for ent in doc.ents:
        entity_text = ent.text.strip()
        
        if ent.label_ == "PERSON":
            if is_valid_person_name(entity_text):
                raw_names.append(entity_text)
        elif ent.label_ == "ORG":
            if is_valid_organization(entity_text):
                raw_organizations.append(entity_text)
    
    # Remove duplicates and clean
    names = list(set(raw_names))
    organizations = list(set(raw_organizations))
    
    # Extract URLs with better validation
    url_pattern = r'https?://[^\s<>"\[\]{}|\\^`]+'
    raw_urls = re.findall(url_pattern, text)
    urls = []
    for url in raw_urls:
        cleaned_url = clean_url(url)
        if cleaned_url:
            urls.append(cleaned_url)
    urls = list(set(urls))
    
    # Extract emails with better validation
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    raw_emails = re.findall(email_pattern, text)
    emails = []
    for email in raw_emails:
        # Skip obvious fake emails
        if not any(fake in email.lower() for fake in ['example', 'test', 'dummy', 'fake']):
            emails.append(email)
    emails = list(set(emails))
    
    # Extract phone numbers with enhanced validation
    phone_numbers = extract_phone_numbers(text)
    
    return {
        'names': sorted(names),
        'organizations': sorted(organizations),
        'urls': sorted(urls),
        'emails': sorted(emails),
        'phone_numbers': sorted(phone_numbers)
    }

def process_all_files():
    """
    Process all .txt files in the deepscrape directory with enhanced extraction
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
            
            # Extract entities with enhanced method
            entities = extract_entities_enhanced(text)
            
            # Print results
            print(f"Names ({len(entities['names'])}): {entities['names']}")
            print(f"Organizations ({len(entities['organizations'])}): {entities['organizations']}")
            print(f"URLs ({len(entities['urls'])}): {entities['urls']}")
            print(f"Emails ({len(entities['emails'])}): {entities['emails']}")
            print(f"Phone Numbers ({len(entities['phone_numbers'])}): {entities['phone_numbers']}")
            
            # Collect for summary
            all_names.extend(entities['names'])
            all_organizations.extend(entities['organizations'])
            all_urls.extend(entities['urls'])
            all_emails.extend(entities['emails'])
            all_phone_numbers.extend(entities['phone_numbers'])
            
        except Exception as e:
            print(f"Error processing {filename}: {str(e)}")
        
        print("\n" + "="*80 + "\n")
    
    # Print summary with statistics
    unique_names = list(set(all_names))
    unique_organizations = list(set(all_organizations))
    unique_urls = list(set(all_urls))
    unique_emails = list(set(all_emails))
    unique_phone_numbers = list(set(all_phone_numbers))
    
    print("ENHANCED SUMMARY - All Unique Entities:")
    print("-" * 60)
    print(f"Total Unique Names ({len(unique_names)}): {unique_names}")
    print(f"Total Unique Organizations ({len(unique_organizations)}): {unique_organizations}")
    print(f"Total Unique URLs ({len(unique_urls)}): {unique_urls}")
    print(f"Total Unique Emails ({len(unique_emails)}): {unique_emails}")
    print(f"Total Unique Phone Numbers ({len(unique_phone_numbers)}): {unique_phone_numbers}")
    
    # Additional statistics
    print("\n" + "="*80)
    print("STATISTICS:")
    print("-" * 60)
    print(f"Total files processed: {len(txt_files)}")
    print(f"Average names per file: {len(all_names) / len(txt_files):.1f}")
    print(f"Average organizations per file: {len(all_organizations) / len(txt_files):.1f}")
    print(f"Average URLs per file: {len(all_urls) / len(txt_files):.1f}")
    print(f"Average emails per file: {len(all_emails) / len(txt_files):.1f}")
    print(f"Average phone numbers per file: {len(all_phone_numbers) / len(txt_files):.1f}")

# Install required package if not already installed
try:
    import phonenumbers
except ImportError:
    print("Installing phonenumbers package...")
    os.system("pip install phonenumbers")
    import phonenumbers

# Process all files in deepscrape directory
process_all_files()