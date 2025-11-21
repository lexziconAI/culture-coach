import os
import re
import json
import base64
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Attachment, FileContent, FileName, FileType, Disposition, ContentId
from dotenv import load_dotenv

load_dotenv()

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL")
SENDGRID_FROM_NAME = os.getenv("SENDGRID_FROM_NAME", "Culture Coach AI")

FOOTER_TEXT = "&copy; 2025 Axiom Intelligence – Interactive Oral Assessments as a Service (IOAaaS) Division"


def normalize_footer(html: str) -> str:
    """Ensure any legacy footer strings are replaced with the official 2025 text."""
    if not html:
        return html
    patterns = [
        r'&copy;\s*2024\s*Axiom Intelligence[^<]*',
        r'©\s*2024\s*Axiom Intelligence[^<]*',
        r'&copy;\s*2025\s*Axiom Intelligence[^<]*Interaction Oral Assessment as a Service[^<]*',
        r'©\s*2025\s*Axiom Intelligence[^<]*Interaction Oral Assessment as a Service[^<]*',
    ]
    for pattern in patterns:
        html = re.sub(pattern, FOOTER_TEXT, html, flags=re.IGNORECASE)
    return html

def get_logo_base64_content():
    logo_path = r"c:\Users\regan\ID SYSTEM\culture_coach\public\logo.png"
    try:
        with open(logo_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            return encoded_string
    except Exception as e:
        print(f"Error loading logo: {e}")
        return None

def generate_html_report(assessment_data):
    """
    Generates a beautiful HTML report for the cultural assessment.
    """
    # Check for AI Generated Report first
    ai_report = assessment_data.get("ai_report_html")
    
    if ai_report:
        ai_report = normalize_footer(ai_report)
        content_body = f"""
        <div class="section">
            {ai_report}
        </div>
        <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #94a3b8;">
            <p>{FOOTER_TEXT}</p>
        </div>
        """
    else:
        # Fallback to static generation
        dimensions = assessment_data.get("dimensions", {})
        summary = assessment_data.get("summary", "No summary available.")
        strengths = assessment_data.get("strengths", [])
        priorities = assessment_data.get("developmentPriorities", [])
        
        # Parse if strings
        if isinstance(strengths, str):
            try: strengths = json.loads(strengths)
            except: strengths = [strengths]
        if isinstance(priorities, str):
            try: priorities = json.loads(priorities)
            except: priorities = [priorities]

        # Dimension Rows
        dim_rows = ""
        dim_labels = {
            "DT": "Directness & Transparency",
            "TR": "Task vs Relational",
            "CO": "Conflict Orientation",
            "CA": "Cultural Adaptability",
            "EP": "Empathy & Perspective"
        }
        
        for code, data in dimensions.items():
            score = data.get("score", 0)
            # Normalize if needed (assuming 0-100)
            label = dim_labels.get(code, code)
            
            dim_rows += f"""
            <div style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-weight: bold; color: #334155;">{label}</span>
                    <span style="font-weight: bold; color: #4f46e5;">{score:.0f}/100</span>
                </div>
                <div style="width: 100%; background-color: #e2e8f0; height: 8px; border-radius: 4px;">
                    <div style="width: {score}%; background-color: #4f46e5; height: 100%; border-radius: 4px;"></div>
                </div>
            </div>
            """

        # Strengths List
        strengths_html = "".join([f"<li style='margin-bottom: 5px;'>{s}</li>" for s in strengths])
        
        # Priorities List
        priorities_html = "".join([f"<li style='margin-bottom: 5px;'>{p}</li>" for p in priorities])
        
        content_body = f"""
            <div class="section">
                <h2>Executive Summary</h2>
                <p>{summary}</p>
            </div>

            <div class="section">
                <h2>Dimension Scores</h2>
                {dim_rows}
            </div>

            <div class="section" style="background-color: #f0fdf4; padding: 15px; border-radius: 8px; border: 1px solid #bbf7d0;">
                <h3 style="margin-top:0; color: #15803d;">Key Strengths</h3>
                <ul style="margin-bottom: 0; padding-left: 20px;">
                    {strengths_html}
                </ul>
            </div>

            <div class="section" style="background-color: #fffbeb; padding: 15px; border-radius: 8px; border: 1px solid #fde68a;">
                <h3 style="margin-top:0; color: #b45309;">Development Priorities</h3>
                <ul style="margin-bottom: 0; padding-left: 20px;">
                    {priorities_html}
                </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #94a3b8;">
                <p>{FOOTER_TEXT}</p>
            </div>
        """

    # Use CID for logo to prevent clipping
    logo_html = '<img src="cid:logo_image" alt="Axiom Logo" style="height: 80px; margin-bottom: 15px; background-color: white; padding: 8px; border-radius: 8px;" />'

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
            .content {{ background-color: #ffffff; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }}
            .section {{ margin-bottom: 25px; }}
            h2 {{ color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-top: 0; }}
            h3 {{ color: #334155; margin-bottom: 10px; }}
            .tag {{ display: inline-block; padding: 4px 8px; background-color: #f1f5f9; border-radius: 4px; font-size: 12px; margin-right: 5px; }}
            ul {{ margin-top: 5px; }}
            li {{ margin-bottom: 5px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                {logo_html}
                <h1 style="margin:0;">Cultural Intelligence Report</h1>
                <p style="margin:5px 0 0 0; opacity: 0.9;">Your Personalized Assessment Results</p>
            </div>
            
            <div class="content">
                {content_body}
            </div>
        </div>
    </body>
    </html>
    """
    return normalize_footer(html_content)

def send_assessment_email(to_email, assessment_data):
    if not SENDGRID_API_KEY:
        print("Error: SendGrid API Key not found.")
        return False

    html_content = generate_html_report(assessment_data)
    
    message = Mail(
        from_email=(SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME),
        to_emails=to_email,
        subject='Your Cultural Intelligence Assessment Report',
        html_content=html_content
    )

    # Attach Logo as Inline Image (CID)
    logo_content = get_logo_base64_content()
    if logo_content:
        attachment = Attachment()
        attachment.file_content = FileContent(logo_content)
        attachment.file_type = FileType('image/png')
        attachment.file_name = FileName('logo.png')
        attachment.disposition = Disposition('inline')
        attachment.content_id = ContentId('logo_image')
        message.attachment = attachment
    
    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        response = sg.send(message)
        print(f"Email sent! Status Code: {response.status_code}")
        return response.status_code in [200, 201, 202]
    except Exception as e:
        print(f"Error sending email: {e}")
        return False
