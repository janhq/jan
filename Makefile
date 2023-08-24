newadr:
	@echo "Initiating an ADR..."
	@read -p "Enter ADR number (e.g. 001): " number; \
	read -p "Enter ADR title: " title; \
	cp $(CURDIR)/adr/adr-template.md $(CURDIR)/adr/adr-$${number}-$${title}.md