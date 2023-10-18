newadr:
	@echo "Initiating an ADR..."
	@last_number=$$(ls $(CURDIR)/adr-[0-9][0-9][0-9]-* | sort -V | tail -n 1 | cut -d '-' -f 2); \
	next_number=$$(printf "%03d" $$(( $$last_number + 1 ))); \
	read -p "Enter ADR title: " title; \
	cp $(CURDIR)/adr-template.md $(CURDIR)/adr-$$next_number-$$title.md
# newadr:
# 	@echo "Initiating an ADR..."
# 	@read -p "Enter ADR number (e.g. 001): " number; \
# 	read -p "Enter ADR title: " title; \
# 	cp $(CURDIR)/adr-template.md $(CURDIR)/adr-$${number}-$${title}.md