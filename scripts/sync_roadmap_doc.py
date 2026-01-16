# scripts/sync_roadmap_doc.py
import os
import requests
from datetime import datetime

# Configuration
LINEAR_API_KEY = os.getenv('LINEAR_API_KEY', '<LINEAR_KEY>')
LINEAR_API_URL = 'https://api.linear.app/graphql'

# Timeline configuration
TIMELINE_START = datetime(2025, 12, 1)  # Dec 2025
TIMELINE_END = datetime(2026, 4, 30)    # Apr 2026
TIMELINE_MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr']
MONTH_WIDTH = 8  # Characters per month in the timeline


def query_linear_projects():
    """Fetch all projects with parent/child relationships from Linear"""

    query = """
    query Projects {
      projects(
        orderBy: updatedAt
        first: 75
      ) {
        nodes {
          id
          name
          description
          state
          targetDate
          startDate
          progress
          priority
          url
          lead {
            name
          }
          teams {
            nodes {
              name
              key
            }
          }
          labels {
            nodes {
              name
            }
          }
        }
      }
    }
    """

    headers = {
        'Authorization': LINEAR_API_KEY,
        'Content-Type': 'application/json',
    }

    response = requests.post(
        LINEAR_API_URL,
        json={'query': query},
        headers=headers
    )

    result = response.json()

    if 'errors' in result:
        print("❌ Linear API Error:", result['errors'])
        return []

    return result['data']['projects']['nodes']


def query_initiatives():
    """Fetch initiatives with their project IDs (lightweight query)"""

    query = """
    query Initiatives {
      initiatives(first: 50, orderBy: updatedAt) {
        nodes {
          id
          name
          description
          status
          targetDate
          sortOrder
          projects(first: 50, orderBy: updatedAt) {
            nodes {
              id
              sortOrder
            }
          }
        }
      }
    }
    """

    headers = {
        'Authorization': LINEAR_API_KEY,
        'Content-Type': 'application/json',
    }

    response = requests.post(
        LINEAR_API_URL,
        json={'query': query},
        headers=headers
    )

    result = response.json()

    if 'errors' in result:
        print("❌ Linear API Error (initiatives):", result['errors'])
        return None

    return result.get('data', {}).get('initiatives', {}).get('nodes', [])


def parse_date(date_str):
    """Parse ISO date string to datetime"""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
    except:
        return None


def create_timeline_bar(start_date, end_date, progress=0):
    """Create an ASCII timeline bar showing the project duration"""
    total_width = len(TIMELINE_MONTHS) * MONTH_WIDTH
    timeline_duration = (TIMELINE_END - TIMELINE_START).days

    # Parse dates
    start_dt = parse_date(start_date) if start_date else None
    end_dt = parse_date(end_date) if end_date else None

    # Default to full timeline if no dates
    if not start_dt and not end_dt:
        return ' ' * total_width

    # Clamp dates to timeline range
    if start_dt:
        start_dt = max(start_dt, TIMELINE_START)
    else:
        start_dt = TIMELINE_START

    if end_dt:
        end_dt = min(end_dt, TIMELINE_END)
    else:
        end_dt = TIMELINE_END

    # Calculate positions
    start_pos = int((start_dt - TIMELINE_START).days / timeline_duration * total_width)
    end_pos = int((end_dt - TIMELINE_START).days / timeline_duration * total_width)

    start_pos = max(0, min(start_pos, total_width))
    end_pos = max(0, min(end_pos, total_width))

    if end_pos <= start_pos:
        end_pos = start_pos + 1

    # Build the bar
    bar_length = end_pos - start_pos
    filled_length = int(bar_length * (progress or 0) / 100)
    empty_length = bar_length - filled_length

    bar = ' ' * start_pos + '█' * filled_length + '░' * empty_length + ' ' * (total_width - end_pos)
    return bar[:total_width]


def create_timeline_header():
    """Create the timeline header with month labels"""
    header = ""
    for month in TIMELINE_MONTHS:
        header += month.center(MONTH_WIDTH)
    return header


def get_status_emoji(state):
    """Get emoji for project state"""
    emoji_map = {
        'started': '🟢',
        'planned': '📋',
        'completed': '✅',
        'canceled': '❌',
        'paused': '⏸️',
        'backlog': '📝'
    }
    return emoji_map.get(state, '📋')


def create_progress_bar(progress, width=10):
    """Create a compact progress bar"""
    progress = progress or 0
    filled = int(progress * width / 100)
    empty = width - filled
    return '▓' * filled + '░' * empty


def format_date_short(date_str):
    """Format date as short string like 'Jan 26' or 'Feb'"""
    if not date_str:
        return "—"
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return dt.strftime('%b %d').replace(' 0', ' ')
    except:
        return "—"


def format_timeline_range(start_date, end_date):
    """Format timeline as a compact range string"""
    start = format_date_short(start_date) if start_date else None
    end = format_date_short(end_date) if end_date else None

    if start and end:
        return f"{start} → {end}"
    elif end:
        return f"→ {end}"
    elif start:
        return f"{start} →"
    return "TBD"


def is_internal_project(project):
    """Check if a project is marked as internal and should be excluded from public roadmap"""
    # Check if project has 'internal' label
    labels = project.get('labels', {}).get('nodes', [])
    for label in labels:
        if label.get('name', '').lower() == 'internal':
            return True

    # Check project state - exclude canceled projects
    state = project.get('state', '')
    if state == 'canceled':
        return True

    return False


def group_projects_by_initiative(initiatives, all_projects):
    """
    Group projects by their parent initiative.
    Preserves manual ordering from Linear using sortOrder.
    Filters out internal projects.
    Returns: (grouped_initiatives, standalone_projects)
    """
    # Filter out internal projects first
    public_projects = [p for p in all_projects if not is_internal_project(p)]

    # Create a lookup map for projects by ID
    projects_by_id = {p['id']: p for p in public_projects}

    # Track which project IDs belong to initiatives
    project_ids_in_initiatives = set()

    # Sort initiatives by sortOrder (manual ordering in Linear)
    sorted_initiatives = sorted(initiatives, key=lambda i: i.get('sortOrder', 0))

    grouped = []
    for initiative in sorted_initiatives:
        # Get project nodes with sortOrder
        project_nodes = initiative.get('projects', {}).get('nodes', [])

        # Sort projects by sortOrder (manual ordering in Linear)
        sorted_project_nodes = sorted(project_nodes, key=lambda p: p.get('sortOrder', 0))

        # Look up full project data while preserving the manual order
        full_projects = []
        for proj_node in sorted_project_nodes:
            pid = proj_node['id']
            if pid in projects_by_id:
                full_projects.append(projects_by_id[pid])
                project_ids_in_initiatives.add(pid)

        # Only include initiatives that have projects
        if full_projects:
            grouped.append({
                'name': initiative.get('name', 'Unnamed Initiative'),
                'description': initiative.get('description', ''),
                'status': initiative.get('status', 'planned'),
                'targetDate': initiative.get('targetDate'),
                'projects': full_projects  # Sorted by sortOrder
            })

    # Find standalone projects (preserve their original order from all_projects)
    standalone = [p for p in all_projects if p['id'] not in project_ids_in_initiatives]

    return grouped, standalone


def generate_roadmap_markdown(initiatives, standalone_projects):
    """Generate GitHub-compatible markdown roadmap with timeline visualization"""

    markdown = f"""# 📍 Roadmap

> This roadmap is automatically synced from our internal planning tools. Timelines are estimates and subject to change based on community feedback and priorities.

**Last updated:** {datetime.now().strftime('%B %d, %Y')}

"""

    # Generate sections for each initiative
    for initiative in initiatives:
        markdown += generate_initiative_section(initiative)

    # Standalone projects section
    if standalone_projects:
        markdown += "## 📦 Other Projects\n\n"
        markdown += generate_projects_table(standalone_projects)
        markdown += "\n---\n\n"

    # Feedback section
    markdown += """## 💬 Feedback & Requests

Have ideas or feature requests? We'd love to hear from you!

- 💡 [Share your ideas in Discussions](https://github.com/janhq/jan/discussions)
- 🐛 [Report bugs in Issues](https://github.com/janhq/jan/issues)
- ⭐ Star features you'd like to see prioritized

"""

    return markdown


def generate_initiative_section(initiative):
    """Generate markdown section for an initiative with timeline bars"""

    name = initiative.get('name', 'Unnamed Initiative')
    description = initiative.get('description', '')
    projects = initiative.get('projects', [])

    # Count projects by state
    project_count = len(projects)
    completed_count = sum(1 for p in projects if p.get('state') == 'completed')

    section = f"### 🎯 {name}"
    section += "\n\n"

    if description:
        # Truncate long descriptions
        if len(description) > 200:
            description = description[:200] + '...'
        section += f"_{description}_\n\n"

    if projects:
        section += generate_projects_table(projects)
    else:
        section += "_No projects in this initiative._\n"

    section += "\n---\n\n"

    return section


def generate_projects_table(projects):
    """Generate ASCII timeline table for projects (preserves input order)"""

    # Find the longest project name to determine column width
    max_name_len = max(len(p.get('name', 'Unnamed')) for p in projects) if projects else 20
    name_col_width = max_name_len + 3  # +3 for emoji and space

    # Create header
    timeline_header = create_timeline_header()
    table = f"```\n{'Project':<{name_col_width}} {timeline_header}\n"
    table += "-" * name_col_width + " " + "-" * len(timeline_header) + "\n"

    # Use projects as-is (already in manual order from Linear)
    for project in projects:
        name = project.get('name', 'Unnamed')
        state = project.get('state', 'planned')
        emoji = get_status_emoji(state)
        progress = project.get('progress', 0) or 0

        # Get timeline bar
        start_date = project.get('startDate')
        end_date = project.get('targetDate')
        timeline_bar = create_timeline_bar(start_date, end_date, progress)

        table += f"{emoji} {name:<{max_name_len}} {timeline_bar}\n"

    table += "```\n"
    return table


def update_roadmap(markdown, roadmap_path='ROADMAP.md'):
    """Update ROADMAP.md with new roadmap section"""

    start_marker = "<!-- ROADMAP:START -->"
    end_marker = "<!-- ROADMAP:END -->"

    try:
        with open(roadmap_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"❌ {roadmap_path} not found!")
        return False

    if start_marker in content and end_marker in content:
        before = content.split(start_marker)[0]
        after = content.split(end_marker)[1]
        new_content = f"{before}{start_marker}\n{markdown}\n{end_marker}{after}"
        print("✅ Updating existing roadmap section...")
    else:
        new_content = f"{content}\n\n{start_marker}\n{markdown}\n{end_marker}\n"
        print("✅ Adding new roadmap section to ROADMAP...")
        print(f"⚠️  Note: Add the markers manually if you want specific placement:")
        print(f"   {start_marker}")
        print(f"   {end_marker}")

    try:
        with open(roadmap_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    except Exception as e:
        print(f"❌ Error writing to ROADMAP: {e}")
        return False


def main():
    print("🔄 Syncing Linear roadmap to ROADMAP.md...\n")

    # Step 1: Try to fetch initiatives
    print("📥 Fetching initiatives from Linear...")
    initiatives = query_initiatives()

    # Step 2: Fetch all projects
    print("📥 Fetching projects from Linear...")
    all_projects = query_linear_projects()

    if not all_projects:
        print("⚠️  No projects found or API error occurred.")
        return

    # Step 3: Group projects by initiative
    if initiatives:
        grouped_initiatives, standalone_projects = group_projects_by_initiative(initiatives, all_projects)
        print(f"✅ Found {len(grouped_initiatives)} initiatives")
    else:
        # Fallback: treat all projects as standalone
        print("⚠️  Could not fetch initiatives, showing all projects as standalone")
        grouped_initiatives = []
        standalone_projects = all_projects

    print(f"✅ Found {len(all_projects)} total projects")
    print(f"✅ Found {len(standalone_projects)} standalone projects\n")

    # Show what we found
    if grouped_initiatives:
        print("Initiatives to sync:")
        for init in grouped_initiatives:
            project_count = len(init.get('projects', []))
            print(f"  🎯 {init['name']} ({project_count} projects)")

    if standalone_projects:
        print("\nStandalone projects:")
        for proj in standalone_projects[:5]:  # Show first 5
            status = get_status_emoji(proj.get('state', 'planned'))
            print(f"  {status} {proj['name']}")
        if len(standalone_projects) > 5:
            print(f"  ... and {len(standalone_projects) - 5} more")
    print()

    # Step 4: Generate markdown
    print("📝 Generating roadmap markdown...")
    markdown = generate_roadmap_markdown(grouped_initiatives, standalone_projects)

    # Step 5: Update ROADMAP
    print("📄 Updating ROADMAP.md...")
    success = update_roadmap(markdown)

    if success:
        print("\n✨ Roadmap synced successfully!")
        print("   Check your ROADMAP.md file")
        print("\n💡 Next steps:")
        print("   1. Review the changes: git diff ROADMAP.md")
        print("   2. Commit: git add ROADMAP.md && git commit -m 'Update roadmap from Linear'")
        print("   3. Push: git push origin main")
    else:
        print("\n❌ Sync failed!")


if __name__ == '__main__':
    main()
